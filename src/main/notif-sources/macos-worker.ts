/**
 * Dedicated Node Worker thread that reads from the macOS Notification
 * Center SQLite DB.
 *
 * Lives off the main thread so its blocking better-sqlite3 calls + 30s
 * poll cadence don't fight Electron's main-process event loop. Communicates
 * with `macos-source.ts` (the orchestrator) only via `parentPort`.
 *
 * Permissions: requires macOS Full Disk Access to read
 * `~/Library/Group Containers/group.com.apple.usernoted/db2/db`. When that
 * fails we log ONE warning and keep retrying silently — onboarding the user
 * through the FDA prompt is Phase D's problem.
 *
 * Ported from Funnel's `src-tauri/src/macos_notif.rs` (which is read-only
 * reference material).
 */

import * as os from 'os';
import * as path from 'path';
import { parentPort } from 'worker_threads';
import Database from 'better-sqlite3';
import bplistParser from 'bplist-parser';

// CFAbsoluteTime epoch is 2001-01-01 UTC; this is its Unix-seconds offset.
const MAC_EPOCH_OFFSET_SECS = 978_307_200;
const MAX_ROWS_PER_POLL = 500;

interface ParsedBody {
  title: string | null;
  body: string | null;
  sender_name: string | null;
  deep_link: string | null;
}

export interface WorkerInboundMessage {
  type: 'stop';
}

export interface WorkerOutboundNotification {
  type: 'notification';
  source_uid: string;
  app_id: string | null;
  subject: string | null;
  body: string | null;
  sender_name: string | null;
  deep_link: string | null;
  received_at: string; // UTC RFC3339
}

export interface WorkerOutboundCursor {
  type: 'cursor';
  /** UTC RFC3339 — latest `received_at` we've seen and persisted. */
  value: string;
}

export interface WorkerOutboundLog {
  type: 'log';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface WorkerOutboundPollComplete {
  type: 'poll-complete';
  /** UTC RFC3339 — when the poll cycle finished (success). */
  iso: string;
}

export type WorkerOutbound =
  | WorkerOutboundNotification
  | WorkerOutboundCursor
  | WorkerOutboundPollComplete
  | WorkerOutboundLog;

function macEpochToIso(seconds: number): string {
  const unix = seconds + MAC_EPOCH_OFFSET_SECS;
  return new Date(unix * 1000).toISOString();
}

function utcIsoToMacEpoch(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000) - MAC_EPOCH_OFFSET_SECS;
}

function macosDbPath(): string {
  return path.join(
    os.homedir(),
    'Library/Group Containers/group.com.apple.usernoted/db2/db',
  );
}

/**
 * Format a 16-byte UUID blob as a canonical 8-4-4-4-12 hex string. For
 * other lengths we just hex-encode (the unique constraint catches dupes
 * either way).
 */
function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  if (bytes.length === 16) {
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
  }
  return hex;
}

/**
 * Walk a parsed plist dict looking for the fields macOS notifications use.
 * Shapes vary by app — most modern notifications nest under `req`, some
 * apps put fields at the top level. We DFS and take the first match per
 * field (matches Funnel's `walk_for_fields`).
 */
function walkForFields(value: unknown, out: ParsedBody): void {
  if (value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)) {
    const dict = value as Record<string, unknown>;
    for (const [key, v] of Object.entries(dict)) {
      switch (key) {
        case 'titl':
        case 'title':
          if (out.title === null && typeof v === 'string') out.title = v;
          break;
        case 'subt':
        case 'subtitle':
          if (out.sender_name === null && typeof v === 'string') out.sender_name = v;
          break;
        case 'body':
          if (out.body === null && typeof v === 'string') out.body = v;
          break;
        case 'url':
        case 'URL':
          if (out.deep_link === null && typeof v === 'string') out.deep_link = v;
          break;
      }
      walkForFields(v, out);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) walkForFields(v, out);
  }
}

function parseBlob(data: Buffer): ParsedBody {
  const out: ParsedBody = { title: null, body: null, sender_name: null, deep_link: null };
  if (data.length === 0) return out;
  try {
    const parsed = bplistParser.parseBuffer(data);
    walkForFields(parsed, out);
  } catch {
    // Defensive: macOS sometimes stores non-bplist payloads. Drop body but
    // still let the row through — we have the timestamp and bundle id.
  }
  return out;
}

function post(msg: WorkerOutbound): void {
  parentPort?.postMessage(msg);
}

/**
 * Single poll cycle. Returns the new cursor (latest `received_at` we
 * persisted) or `null` if nothing changed / we couldn't open the DB.
 *
 * Uses `delivered_date >= cursor` (not `>`) so we don't silently drop rows
 * that share a timestamp with the cursor — boundary dupes are absorbed by
 * the PRIMARY KEY + `INSERT OR IGNORE` in `notif-db.ts`. This matches
 * Funnel's safety pattern.
 */
function pollOnce(cursorRfc: string | null, warnedFda: { value: boolean }): string | null {
  const dbPath = macosDbPath();
  let conn: Database.Database;
  try {
    conn = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    const isPermission =
      lower.includes('authorization denied') ||
      lower.includes('not authorized') ||
      lower.includes('operation not permitted') ||
      lower.includes('permission denied');
    if (isPermission && !warnedFda.value) {
      warnedFda.value = true;
      post({
        type: 'log',
        level: 'warn',
        message:
          'macOS Notification Center DB unreadable. Grant Full Disk Access ' +
          'to Harbor under System Settings > Privacy & Security > Full Disk ' +
          `Access. Underlying: ${msg}`,
      });
    } else if (!isPermission) {
      post({ type: 'log', level: 'warn', message: `macos notif: open failed: ${msg}` });
    }
    return null;
  }

  try {
    const sinceMac = cursorRfc !== null ? utcIsoToMacEpoch(cursorRfc) : 0;
    const stmt = conn.prepare(
      `SELECT r.uuid, r.data, r.delivered_date, a.identifier
         FROM record r
         LEFT JOIN app a ON a.app_id = r.app_id
        WHERE r.delivered_date IS NOT NULL AND r.delivered_date >= ?
        ORDER BY r.delivered_date ASC
        LIMIT ?`,
    );
    const rows = stmt.all(sinceMac, MAX_ROWS_PER_POLL) as Array<{
      uuid: Buffer | string | null;
      data: Buffer | null;
      delivered_date: number;
      identifier: string | null;
    }>;

    let maxReceived: string | null = cursorRfc;
    for (const row of rows) {
      let uid: string;
      if (Buffer.isBuffer(row.uuid)) uid = formatUuid(row.uuid);
      else if (typeof row.uuid === 'string') uid = row.uuid;
      else continue;

      const data = Buffer.isBuffer(row.data) ? row.data : Buffer.alloc(0);
      const parsed = parseBlob(data);
      const receivedAt = macEpochToIso(row.delivered_date);

      post({
        type: 'notification',
        source_uid: uid,
        app_id: row.identifier ?? null,
        subject: parsed.title,
        body: parsed.body,
        sender_name: parsed.sender_name,
        deep_link: parsed.deep_link,
        received_at: receivedAt,
      });

      if (maxReceived === null || receivedAt > maxReceived) {
        maxReceived = receivedAt;
      }
    }

    if (maxReceived !== null && maxReceived !== cursorRfc) {
      post({ type: 'cursor', value: maxReceived });
      return maxReceived;
    }
    return cursorRfc;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    post({ type: 'log', level: 'warn', message: `macos notif: poll failed: ${msg}` });
    return cursorRfc;
  } finally {
    try {
      conn.close();
    } catch {
      // Best-effort.
    }
  }
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

let stopped = false;
let cursor: string | null = null;
const warnedFda = { value: false };

parentPort?.on('message', (msg: WorkerInboundMessage | { type: 'init'; cursor: string | null } | { type: 'poll-now' }) => {
  if (msg.type === 'stop') {
    stopped = true;
    return;
  }
  if (msg.type === 'init') {
    cursor = msg.cursor;
    return;
  }
  if (msg.type === 'poll-now') {
    const next = pollOnce(cursor, warnedFda);
    if (next !== null) {
      cursor = next;
      post({ type: 'poll-complete', iso: new Date().toISOString() });
    }
  }
});

// Phase E.0: no background loop. Polls happen only on explicit 'poll-now'
// messages from the orchestrator (triggered by the user clicking "Poll now"
// in Settings -> Sources).
