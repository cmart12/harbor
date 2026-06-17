/**
 * WorkIQ polling worker thread (Phase C.1).
 *
 * Runs off the main process in a dedicated Node Worker thread. Owns:
 *  - a cached CopilotSession for the worker's lifetime,
 *  - a 5-minute poll loop that asks WorkIQ (via the Copilot SDK) for
 *    recent Outlook emails and Teams messages,
 *  - response parsing and blake3 content-based dedupe,
 *  - posting parsed items + cursor updates back to the parent.
 *
 * Communication with the parent (`workiq-source.ts`) is exclusively
 * through `parentPort.postMessage`. The parent owns all DB writes and
 * IPC events.
 *
 * Ported from Funnel's `workiq_source.rs` prompt and parser, adapted
 * to TypeScript and the Copilot SDK (instead of CLI subprocess).
 */

import { parentPort } from 'worker_threads';
import type { CopilotSession } from '@github/copilot-sdk';
import { getEphemeralCopilotClient } from '../ai';
import { InMemoryFsProvider } from '../agents/in-memory-fs-provider';
import { contentHash, dayBucket } from './blake3-hash';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes
const BACKFILL_DAYS = 7;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 5_000, 30_000];
const SDK_TIMEOUT_MS = 60_000;

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
}

/** Messages FROM parent TO worker. */
export type WorkerInbound =
  | { type: 'init'; cursor: string | null }
  | { type: 'poll-now' }
  | { type: 'stop' };

/** Messages FROM worker TO parent. */
export type WorkerOutbound =
  | { type: 'notifications'; items: WorkIQItem[]; cursor: string }
  | { type: 'error'; error: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

// ---------------------------------------------------------------------------
// SDK session management (mirrors classifier pattern)
// ---------------------------------------------------------------------------

let cachedSession: CopilotSession | null = null;

const SYSTEM_MESSAGE = `You are a notification bridge. When asked, query the user's Microsoft 365 data via WorkIQ and return the results as a JSON array. Return ONLY the JSON array, no markdown fences, no commentary.`;

async function getSession(): Promise<CopilotSession | null> {
  if (cachedSession) return cachedSession;
  const client = getEphemeralCopilotClient();
  if (!client) return null;
  try {
    cachedSession = await client.createSession({
      systemMessage: { content: SYSTEM_MESSAGE },
      onPermissionRequest: async () => ({ kind: 'reject' as const }),
      createSessionFsProvider: () => new InMemoryFsProvider(),
    } as any);
    return cachedSession;
  } catch (err) {
    post({ type: 'log', level: 'warn', message: `createSession failed: ${err}` });
    return null;
  }
}

function dropSession(): void {
  if (cachedSession) {
    try { void cachedSession.disconnect(); } catch { /* ignore */ }
  }
  cachedSession = null;
}

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
  // Strip markdown code fences
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  // Find the outermost [...] in the response
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

    // Day-bucketed blake3 dedupe. If the API returned a stable UID and a
    // deep link, hash those for stability. Otherwise fall back to a
    // content-based composite key (matches Funnel's scheme).
    const day = dayBucket(receivedAt);
    let uid: string;
    if (rawUid && deepLink) {
      uid = contentHash(source, deepLink, day);
    } else if (rawUid) {
      uid = contentHash(source, rawUid, day);
    } else if (source === 'workiq-outlook') {
      uid = contentHash('outlook', senderEmail ?? '', subject ?? '', day);
    } else {
      // Teams: channel/sender/body prefix
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

function defaultCursor(): string {
  const d = new Date();
  d.setDate(d.getDate() - BACKFILL_DAYS);
  return d.toISOString();
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

    const session = await getSession();
    if (!session) {
      lastError = 'No SDK session available';
      continue;
    }

    try {
      const prompt = buildWorkIQPrompt(cursorIso);
      const response = await session.sendAndWait({ prompt }, SDK_TIMEOUT_MS) as
        { data?: { content?: string } } | null;
      const responseText = response?.data?.content ?? '';

      const rawArray = extractJsonArray(responseText);
      if (!rawArray) {
        // Empty or unparseable response; treat as no-new-items
        post({ type: 'log', level: 'info', message: 'WorkIQ response contained no parseable array' });
        return { items: [], cursor: cursorIso };
      }

      const items = parseWorkIQItems(rawArray);
      // Advance cursor to the latest received_at among the items
      let newCursor = cursorIso;
      for (const item of items) {
        if (item.received_at > newCursor) newCursor = item.received_at;
      }
      return { items, cursor: newCursor };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      post({ type: 'log', level: 'warn', message: `poll attempt ${attempt + 1} failed: ${lastError}` });
      // Drop session on error so next attempt rebuilds it
      dropSession();
    }
  }

  // All attempts exhausted
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
      // Trigger an immediate poll without waiting for the interval
      if (!pollPromise) {
        pollPromise = runPoll().finally(() => { pollPromise = null; });
      }
      break;
    case 'stop':
      stopped = true;
      break;
  }
});

async function runPoll(): Promise<void> {
  if (stopped) return;
  const c = cursor ?? defaultCursor();
  post({ type: 'log', level: 'info', message: `polling WorkIQ since ${c}` });
  const result = await pollOnce(c);
  if (result) {
    cursor = result.cursor;
    if (result.items.length > 0) {
      post({ type: 'notifications', items: result.items, cursor: result.cursor });
    } else {
      // Still update cursor even with no items (the poll succeeded)
      post({ type: 'log', level: 'info', message: `poll complete, no new items` });
    }
  }
}

async function loop(): Promise<void> {
  // Wait briefly for the init message to arrive
  await sleep(500);

  while (!stopped) {
    await runPoll();
    // Sleep between polls
    await sleep(POLL_INTERVAL_MS);
  }
}

void loop();
