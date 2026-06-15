/**
 * Sidecar SQLite database for notifications (Phase A.2).
 *
 * Why a sidecar:
 *  - Notifications are high-volume / mostly disposable; replaying them
 *    through whim's event log on every cold start would be wasted work.
 *  - The authoritative copy lives elsewhere (macOS Notification Center,
 *    Slack, WorkIQ). We're a cache over those sources.
 *  - The one bit we DO care about durably is "this Space was spawned from
 *    notification X". That fact rides through the event log via
 *    `space:create` with `source_notification_id`, so the linkage survives
 *    even if `notifications.db` is wiped.
 *
 * Path: `<userData>/notifications.db` (resolved via `app-paths.ts` pinning).
 * Schema is created with `CREATE TABLE IF NOT EXISTS` — no migrations table,
 * matching `database.ts`. Status is a code-level enum (see
 * `notification-types.ts`); we deliberately do NOT add a CHECK constraint
 * so widening the enum stays a one-line change.
 */

import * as path from 'path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import type {
  Notification,
  NotificationListFilter,
  NotificationStatus,
} from '../shared/notification-types';

let db: Database.Database | null = null;

const NOTIF_DB_FILE = 'notifications.db';

/** Pragmas ported from Funnel's `store.rs::new_connection`. */
function applyPragmas(conn: Database.Database): void {
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
}

function createSchema(conn: Database.Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      source_uid TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      app_id TEXT,
      sender_name TEXT,
      sender_email TEXT,
      subject TEXT,
      body TEXT,
      received_at TEXT NOT NULL,
      deep_link TEXT,
      status TEXT NOT NULL DEFAULT 'unread',
      snoozed_until TEXT,
      promoted_space_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_received_at ON notifications(received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    CREATE INDEX IF NOT EXISTS idx_notifications_snoozed_until ON notifications(snoozed_until);

    CREATE TABLE IF NOT EXISTS notif_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

/**
 * Open the sidecar DB. Idempotent: a second call returns the same connection.
 *
 * An override path can be passed for tests (in-memory or temp file) so we
 * don't have to stand up Electron's `app` machinery in vitest.
 */
export function openNotifDb(overridePath?: string): Database.Database {
  if (db) return db;
  const dbPath = overridePath ?? path.join(app.getPath('userData'), NOTIF_DB_FILE);
  const conn = new Database(dbPath);
  applyPragmas(conn);
  createSchema(conn);
  db = conn;
  return db;
}

export function closeNotifDb(): void {
  if (db) {
    try {
      db.close();
    } catch (err) {
      console.warn('[notif-db] close failed:', err);
    }
    db = null;
  }
}

/** Test-only: drop the cached handle without closing it. */
export function _resetForTests(): void {
  db = null;
}

function requireDb(): Database.Database {
  if (!db) throw new Error('notif-db not initialized; call openNotifDb() first');
  return db;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Input shape for inserting a notification. The reader (macOS source) builds
 * this; status defaults to `unread`.
 */
export interface InsertNotificationInput {
  source_uid: string;
  source: string;
  app_id?: string | null;
  sender_name?: string | null;
  sender_email?: string | null;
  subject?: string | null;
  body?: string | null;
  /** UTC RFC3339. */
  received_at: string;
  deep_link?: string | null;
}

/**
 * Insert a notification. Uses `INSERT OR IGNORE` so re-ingesting the same
 * `source_uid` is a no-op (matches Funnel's UNIQUE-constraint dedupe). Returns
 * `true` when a new row was actually written.
 */
export function insertNotification(input: InsertNotificationInput): boolean {
  const conn = requireDb();
  const now = new Date().toISOString();
  const stmt = conn.prepare(
    `INSERT OR IGNORE INTO notifications
       (source_uid, source, app_id, sender_name, sender_email, subject, body,
        received_at, deep_link, status, snoozed_until, promoted_space_id,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread', NULL, NULL, ?, ?)`,
  );
  const info = stmt.run(
    input.source_uid,
    input.source,
    input.app_id ?? null,
    input.sender_name ?? null,
    input.sender_email ?? null,
    input.subject ?? null,
    input.body ?? null,
    input.received_at,
    input.deep_link ?? null,
    now,
    now,
  );
  return info.changes > 0;
}

export function getNotification(uid: string): Notification | null {
  const row = requireDb()
    .prepare(
      `SELECT source_uid, source, app_id, sender_name, sender_email, subject,
              body, received_at, deep_link, status, snoozed_until,
              promoted_space_id, created_at, updated_at
       FROM notifications WHERE source_uid = ?`,
    )
    .get(uid) as Notification | undefined;
  return row ?? null;
}

/**
 * List notifications.
 *
 * When `filter.status` is unset we return the "active" feed: everything that
 * is NOT archived, done, or promoted, AND not currently snoozed into the
 * future. This matches the brief's default Feed contract.
 *
 * When `filter.status` is set we return rows with that exact status (no
 * future-snooze filtering — caller is asking explicitly).
 */
export function listNotifications(filter: NotificationListFilter = {}): Notification[] {
  const conn = requireDb();
  const limit = filter.limit ?? 200;
  const offset = filter.offset ?? 0;

  if (filter.status) {
    return conn
      .prepare(
        `SELECT source_uid, source, app_id, sender_name, sender_email, subject,
                body, received_at, deep_link, status, snoozed_until,
                promoted_space_id, created_at, updated_at
         FROM notifications
         WHERE status = ?
         ORDER BY received_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(filter.status, limit, offset) as Notification[];
  }

  // Default "active feed" query.
  const now = new Date().toISOString();
  return conn
    .prepare(
      `SELECT source_uid, source, app_id, sender_name, sender_email, subject,
              body, received_at, deep_link, status, snoozed_until,
              promoted_space_id, created_at, updated_at
       FROM notifications
       WHERE status NOT IN ('archived', 'done', 'promoted')
         AND (status != 'snoozed' OR snoozed_until IS NULL OR snoozed_until <= ?)
       ORDER BY received_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(now, limit, offset) as Notification[];
}

/**
 * Update status (and optionally `snoozed_until`). When transitioning OUT of
 * `snoozed` we clear `snoozed_until` automatically.
 */
export function updateStatus(
  uid: string,
  status: NotificationStatus,
  snoozedUntil?: string | null,
): boolean {
  const conn = requireDb();
  const now = new Date().toISOString();
  const snooze = status === 'snoozed' ? (snoozedUntil ?? null) : null;
  const info = conn
    .prepare(
      `UPDATE notifications
          SET status = ?, snoozed_until = ?, updated_at = ?
        WHERE source_uid = ?`,
    )
    .run(status, snooze, now, uid);
  return info.changes > 0;
}

/**
 * Atomically set status='promoted' and record the Space id this notification
 * spawned. Called by the promote-to-new-space IPC handler after the Space
 * row has been written.
 */
export function setPromotedSpace(uid: string, spaceId: string): boolean {
  const conn = requireDb();
  const now = new Date().toISOString();
  const info = conn
    .prepare(
      `UPDATE notifications
          SET status = 'promoted',
              promoted_space_id = ?,
              snoozed_until = NULL,
              updated_at = ?
        WHERE source_uid = ?`,
    )
    .run(spaceId, now, uid);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Cursor / metadata (used by macOS poller)
// ---------------------------------------------------------------------------

export function getMeta(key: string): string | null {
  const row = requireDb()
    .prepare('SELECT value FROM notif_meta WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  requireDb()
    .prepare(
      `INSERT INTO notif_meta(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}
