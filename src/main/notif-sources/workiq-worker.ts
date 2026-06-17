/**
 * WorkIQ polling worker thread (Phase C.1).
 *
 * Runs off the main process in a dedicated Node Worker thread. Owns:
 *  - the 5-minute poll scheduler,
 *  - prompt construction,
 *  - response parsing and blake3 content-based dedupe,
 *  - cursor tracking and retry/backoff,
 *  - posting parsed items + cursor updates back to the parent.
 *
 * Does NOT call the Copilot SDK directly: worker_threads cannot load
 * Electron's `electron` module, and `ai.getEphemeralCopilotClient()`
 * transitively imports it. Instead, the worker asks the parent to make
 * each SDK round-trip via a `request-poll` / `sdk-response` exchange.
 *
 * Communication with the parent (`workiq-source.ts`) is exclusively
 * through `parentPort.postMessage`. The parent owns SDK session
 * management, DB writes, and IPC events.
 *
 * Ported from Funnel's `workiq_source.rs` prompt and parser, adapted
 * to TypeScript and split across main/worker for Electron compatibility.
 */

import { parentPort } from 'worker_threads';
import { contentHash, dayBucket } from './blake3-hash';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes
const BACKFILL_HOURS = 24;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 5_000, 30_000];
// Worker-side timeout on the parent round-trip. Must be larger than the
// SDK_TIMEOUT_MS in the orchestrator (currently 180s) so the parent's
// timeout fires first and we get a real error message instead of a
// generic 'SDK request timed out in worker'.
const SDK_REQUEST_TIMEOUT_MS = 210_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkIQItem {
  source: 'workiq-outlook' | 'workiq-teams';
  source_uid: string;
  sender_name: string | null;
  sender_email: string | null;
  subject: string | null;
  body: string | null;
  received_at: string;
  deep_link: string | null;
  /** Phase C.0: Outlook conversation_id when available. */
  conversation_id: string | null;
  /** Phase C.0: Teams channel_id when available. */
  channel_id: string | null;
  /** Phase C.0: Teams thread_id from SDK response when available. */
  thread_id_from_response: string | null;
}

/** Messages FROM parent TO worker. */
export type WorkerInbound =
  | { type: 'init'; cursor: string | null }
  | { type: 'poll-now' }
  | { type: 'stop' }
  | { type: 'sdk-response'; id: string; success: true; text: string }
  | { type: 'sdk-response'; id: string; success: false; error: string };

/** Messages FROM worker TO parent. */
export type WorkerOutbound =
  | { type: 'notifications'; items: WorkIQItem[]; cursor: string }
  | { type: 'error'; error: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'request-poll'; id: string; prompt: string };

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function buildWorkIQPrompt(cursorIso: string): string {
  return [
    `List my Outlook emails and Teams messages received since ${cursorIso}.`,
    'Return a JSON array where each element has these fields:',
    '  source: "workiq-outlook" or "workiq-teams"',
    '  source_uid: a stable identifier for this item (message id, conversation id, etc.)',
    '  sender_name: display name of the sender',
    '  sender_email: email address of the sender (null if unavailable)',
    '  subject: email subject or Teams channel/chat name',
    '  body: first 200 characters of the message body',
    '  received_at: ISO 8601 timestamp when the message was received',
    '  deep_link: URL to open this item in Outlook/Teams (null if unavailable)',
    '  conversation_id: (Outlook only) the conversation/thread id grouping related emails (null if unavailable)',
    '  channel_id: (Teams only) the channel id this message belongs to (null if unavailable or a chat)',
    '  thread_id: (Teams only) the thread/reply-chain id within the channel (null if unavailable or top-level)',
    '',
    'Return ONLY the JSON array. No markdown fences, no explanation.',
    'If there are no results, return an empty array: []',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Extract a JSON array from the SDK response text. The model sometimes
 * wraps output in markdown fences or adds commentary; we strip those and
 * find the outermost `[...]`.
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

function isValidSource(v: unknown): v is 'workiq-outlook' | 'workiq-teams' {
  return v === 'workiq-outlook' || v === 'workiq-teams';
}

/**
 * Parse raw array elements into typed WorkIQItems with blake3 dedupe UIDs.
 * Invalid elements are silently dropped.
 */
export function parseWorkIQItems(raw: unknown[]): WorkIQItem[] {
  const items: WorkIQItem[] = [];
  for (const el of raw) {
    if (!el || typeof el !== 'object') continue;
    const obj = el as Record<string, unknown>;

    const source = obj.source;
    if (!isValidSource(source)) continue;

    const receivedAt = typeof obj.received_at === 'string' ? obj.received_at : new Date().toISOString();
    const senderName = typeof obj.sender_name === 'string' ? obj.sender_name : null;
    const senderEmail = typeof obj.sender_email === 'string' ? obj.sender_email : null;
    const subject = typeof obj.subject === 'string' ? obj.subject : null;
    const body = typeof obj.body === 'string' ? obj.body : null;
    const deepLink = typeof obj.deep_link === 'string' ? obj.deep_link : null;
    const rawUid = typeof obj.source_uid === 'string' ? obj.source_uid : null;

    // Phase C.0: threading fields (optional from SDK)
    const conversationId = typeof obj.conversation_id === 'string' ? obj.conversation_id : null;
    const channelId = typeof obj.channel_id === 'string' ? obj.channel_id : null;
    const threadIdFromResponse = typeof obj.thread_id === 'string' ? obj.thread_id : null;

    const day = dayBucket(receivedAt);
    let uid: string;
    if (rawUid && deepLink) {
      uid = contentHash(source, deepLink, day);
    } else if (rawUid) {
      uid = contentHash(source, rawUid, day);
    } else if (source === 'workiq-outlook') {
      uid = contentHash('outlook', senderEmail ?? '', subject ?? '', day);
    } else {
      const bodyPrefix = (body ?? '').slice(0, 100);
      uid = contentHash('teams', subject ?? '', senderName ?? '', bodyPrefix, day);
    }

    items.push({
      source,
      source_uid: uid,
      sender_name: senderName,
      sender_email: senderEmail,
      subject,
      body,
      received_at: receivedAt,
      deep_link: deepLink,
      conversation_id: conversationId,
      channel_id: channelId,
      thread_id_from_response: threadIdFromResponse,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(msg: WorkerOutbound): void {
  parentPort?.postMessage(msg);
}

/**
 * Stringify a value safely for forwarding through `{ type: 'log' }`.
 * Errors render as `stack ?? message ?? String(err)`. Objects go through
 * JSON.stringify with a circular-ref fallback so a stray ref doesn't
 * crash the worker.
 */
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

/**
 * Worker-side log helper. The worker cannot import `mainLog` (Electron
 * is not loadable in worker_threads), so we route through a parentPort
 * message that the orchestrator forwards to `mainLog` -- which in turn
 * writes to <userData>/logs/main.log and the debug-tap file.
 */
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
  // Initial backfill window. Kept tight (24h) so the very first poll
  // doesn't blow the SDK timeout. Subsequent polls advance from
  // last_cursor_iso and are cheap. Force re-backfill clears the cursor
  // and lands here again, so this is also the "rebackfill" floor.
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

/**
 * Ask the parent (main process) to call the SDK with this prompt.
 * Resolves with the response text, rejects on error or timeout.
 */
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

function resolveSdkResponse(msg: Extract<WorkerInbound, { type: 'sdk-response' }>): void {
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

async function pollOnce(cursorIso: string): Promise<{ items: WorkIQItem[]; cursor: string } | null> {
  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(BACKOFF_MS[attempt - 1] ?? 30_000);
    }

    try {
      const prompt = buildWorkIQPrompt(cursorIso);
      const responseText = await requestSdkPoll(prompt);

      workerLog('info', 'poll cycle complete');

      const rawArray = extractJsonArray(responseText);
      if (!rawArray) {
        workerLog('info', 'WorkIQ response contained no parseable array');
        return { items: [], cursor: cursorIso };
      }

      const items = parseWorkIQItems(rawArray);
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

parentPort?.on('message', (msg: WorkerInbound) => {
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
      // Reject any pending SDK requests so the worker can exit cleanly
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
  workerLog('info', `polling WorkIQ since ${c}`);
  const result = await pollOnce(c);
  if (result) {
    cursor = result.cursor;
    // Always post notifications (even with zero items) so the parent
    // updates last_poll_iso and clears any stale last_error. Empty
    // batches are the common case once WorkIQ is caught up.
    post({ type: 'notifications', items: result.items, cursor: result.cursor });
    if (result.items.length === 0) {
      workerLog('info', `poll complete, no new items`);
    }
  }
}

async function loop(): Promise<void> {
  await sleep(500);

  while (!stopped) {
    await runPoll();
    await sleep(POLL_INTERVAL_MS);
  }
}

void loop();
