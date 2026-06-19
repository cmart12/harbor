/**
 * Slack polling worker thread (Phase C.4).
 *
 * Runs off the main process in a dedicated Node Worker thread. Owns:
 *  - prompt construction (mentions + DMs only),
 *  - response parsing and blake3 content-based dedupe,
 *  - cursor tracking and retry/backoff,
 *  - posting parsed items + cursor updates back to the parent.
 *
 * Does NOT call the Copilot SDK directly: worker_threads cannot load
 * Electron's `electron` module. Instead, the worker asks the parent to
 * make each SDK round-trip via a `request-poll` / `sdk-response`
 * exchange. Mirrors the workiq-worker pattern from Phase C.1.
 */

import { parentPort } from 'worker_threads';
import { contentHash, dayBucket } from './blake3-hash';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKFILL_HOURS = 24;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 5_000, 30_000];
const SDK_REQUEST_TIMEOUT_MS = 210_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlackItem {
  source: 'slack';
  source_uid: string;
  sender_name: string | null;
  sender_email: string | null;
  subject: string | null;
  body: string | null;
  received_at: string;
  deep_link: string | null;
  channel_id: string | null;
  thread_ts: string | null;
}

/** Messages FROM parent TO worker. */
export type SlackWorkerInbound =
  | { type: 'init'; cursor: string | null }
  | { type: 'poll-now' }
  | { type: 'stop' }
  | { type: 'sdk-response'; id: string; success: true; text: string }
  | { type: 'sdk-response'; id: string; success: false; error: string };

/** Messages FROM worker TO parent. */
export type SlackWorkerOutbound =
  | { type: 'notifications'; items: SlackItem[]; cursor: string }
  | { type: 'error'; error: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'request-poll'; id: string; prompt: string };

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function buildSlackPrompt(cursorIso: string): string {
  return [
    `List my Slack mentions and direct messages received since ${cursorIso}.`,
    'Include messages where I was @mentioned in channels and all messages in my DM conversations.',
    'Do NOT include general channel activity where I was not mentioned.',
    '',
    'Return a JSON array where each element has these fields:',
    '  source: "slack"',
    '  source_uid: a stable identifier for this message (message ts or unique id)',
    '  sender_name: display name of the sender',
    '  sender_email: email address of the sender (null if unavailable)',
    '  subject: channel name (e.g. "#general") or "DM with <name>"',
    '  body: first 200 characters of the message body',
    '  received_at: ISO 8601 timestamp when the message was sent',
    '  deep_link: URL to open this message in Slack (slack:// or https://app.slack.com/...)',
    '  channel_id: Slack channel ID (e.g. "C01234ABC") if available, null otherwise',
    '  thread_ts: thread timestamp if this is a threaded reply, null otherwise',
    '',
    'Return ONLY the JSON array. No markdown fences, no explanation.',
    'If there are no results, return an empty array: []',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Extract a JSON array from the SDK response text. Strips markdown fences
 * and finds the outermost `[...]`. Shared logic with workiq-worker.
 */
export function extractJsonArray(text: string): unknown[] | null {
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  const start = stripped.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === '[') depth++;
    else if (stripped[i] === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Parse raw array elements into typed SlackItems with blake3 dedupe UIDs.
 * Invalid elements are silently dropped.
 */
export function parseSlackItems(raw: unknown[]): SlackItem[] {
  const items: SlackItem[] = [];
  for (const el of raw) {
    if (!el || typeof el !== 'object') continue;
    const obj = el as Record<string, unknown>;

    if (obj.source !== 'slack') continue;

    const receivedAt = typeof obj.received_at === 'string' ? obj.received_at : new Date().toISOString();
    const senderName = typeof obj.sender_name === 'string' ? obj.sender_name : null;
    const senderEmail = typeof obj.sender_email === 'string' ? obj.sender_email : null;
    const subject = typeof obj.subject === 'string' ? obj.subject : null;
    const body = typeof obj.body === 'string' ? obj.body : null;
    const deepLink = typeof obj.deep_link === 'string' ? obj.deep_link : null;
    const rawUid = typeof obj.source_uid === 'string' ? obj.source_uid : null;
    const channelId = typeof obj.channel_id === 'string' ? obj.channel_id : null;
    const threadTs = typeof obj.thread_ts === 'string' ? obj.thread_ts : null;

    const day = dayBucket(receivedAt);
    let uid: string;
    if (channelId && rawUid) {
      // Preferred: (source, channel_id, sender_id_or_uid, ts, day)
      uid = contentHash('slack', channelId, rawUid, day);
    } else if (rawUid) {
      uid = contentHash('slack', rawUid, day);
    } else {
      // Fallback: (source, sender_name, bodyPrefix100, day)
      const bodyPrefix = (body ?? '').slice(0, 100);
      uid = contentHash('slack', senderName ?? '', bodyPrefix, day);
    }

    items.push({
      source: 'slack',
      source_uid: uid,
      sender_name: senderName,
      sender_email: senderEmail,
      subject,
      body,
      received_at: receivedAt,
      deep_link: deepLink,
      channel_id: channelId,
      thread_ts: threadTs,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(msg: SlackWorkerOutbound): void {
  parentPort?.postMessage(msg);
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message ?? String(value);
  }
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function workerLog(level: 'info' | 'warn' | 'error', ...args: unknown[]): void {
  const message = args.map(safeStringify).join(' ');
  post({ type: 'log', level, message });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

function defaultCursor(): string {
  const d = new Date();
  d.setHours(d.getHours() - BACKFILL_HOURS);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// SDK round-trip through the parent
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRequest>();
let requestCounter = 0;

function nextRequestId(): string {
  requestCounter += 1;
  return `req-${Date.now()}-${requestCounter}`;
}

function requestSdkPoll(prompt: string): Promise<string> {
  const id = nextRequestId();
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('SDK request timed out in worker'));
      }
    }, SDK_REQUEST_TIMEOUT_MS);
    timer.unref?.();
    pending.set(id, { resolve, reject, timer });
    post({ type: 'request-poll', id, prompt });
  });
}

function resolveSdkResponse(msg: Extract<SlackWorkerInbound, { type: 'sdk-response' }>): void {
  const entry = pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);
  clearTimeout(entry.timer);
  if (msg.success) {
    entry.resolve(msg.text);
  } else {
    entry.reject(new Error(msg.error));
  }
}

// ---------------------------------------------------------------------------
// Poll cycle
// ---------------------------------------------------------------------------

async function pollOnce(cursorIso: string): Promise<{ items: SlackItem[]; cursor: string } | null> {
  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(BACKOFF_MS[attempt - 1] ?? 30_000);
    }

    try {
      const prompt = buildSlackPrompt(cursorIso);
      const responseText = await requestSdkPoll(prompt);

      workerLog('info', 'poll cycle complete');

      const rawArray = extractJsonArray(responseText);
      if (!rawArray) {
        workerLog('info', 'Slack response contained no parseable array');
        return { items: [], cursor: cursorIso };
      }

      const items = parseSlackItems(rawArray);
      let newCursor = cursorIso;
      for (const item of items) {
        if (item.received_at > newCursor) newCursor = item.received_at;
      }
      return { items, cursor: newCursor };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      workerLog('warn', `poll attempt ${attempt + 1} failed: ${lastError}`);
    }
  }

  post({ type: 'error', error: lastError ?? 'unknown error' });
  return null;
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

let stopped = false;
let cursor: string | null = null;
let pollPromise: Promise<void> | null = null;

parentPort?.on('message', (msg: SlackWorkerInbound) => {
  switch (msg.type) {
    case 'init':
      cursor = msg.cursor ?? defaultCursor();
      break;
    case 'poll-now':
      if (!pollPromise) {
        pollPromise = runPoll().finally(() => { pollPromise = null; });
      }
      break;
    case 'stop':
      stopped = true;
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Worker stopping'));
      }
      pending.clear();
      break;
    case 'sdk-response':
      resolveSdkResponse(msg);
      break;
  }
});

async function runPoll(): Promise<void> {
  if (stopped) return;
  const c = cursor ?? defaultCursor();
  workerLog('info', `polling Slack since ${c}`);
  const result = await pollOnce(c);
  if (result) {
    cursor = result.cursor;
    post({ type: 'notifications', items: result.items, cursor: result.cursor });
    if (result.items.length === 0) {
      workerLog('info', `poll complete, no new items`);
    }
  }
}

// Phase E.0: no background loop. Polls happen only on explicit 'poll-now'
// messages from the orchestrator (triggered by the user clicking "Poll now"
// in Settings -> Sources).
