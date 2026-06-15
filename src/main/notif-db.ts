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
import * as crypto from 'crypto';
import { app } from 'electron';
import Database from 'better-sqlite3';
import type {
  Notification,
  NotificationListFilter,
  NotificationStatus,
} from '../shared/notification-types';
import type {
  Goal,
  Category,
  CreateGoalInput,
  CreateCategoryInput,
  UpdateGoalPatch,
  UpdateCategoryPatch,
  ListGoalsFilter,
  ListCategoriesFilter,
} from '../shared/goal-category-types';
import {
  DEFAULT_GOAL_COLOR,
  DEFAULT_CATEGORY_COLOR,
} from '../shared/goal-category-types';

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

    -- Phase B.1: goals + categories live in the sidecar DB alongside
    -- notifications. Schema is symmetric across the two entities so the
    -- B.2 classifier can join either dimension uniformly.
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      color TEXT NOT NULL DEFAULT '${DEFAULT_GOAL_COLOR}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_goals_sort_order ON goals(sort_order);
    CREATE INDEX IF NOT EXISTS idx_goals_archived_at ON goals(archived_at);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      color TEXT NOT NULL DEFAULT '${DEFAULT_CATEGORY_COLOR}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);
    CREATE INDEX IF NOT EXISTS idx_categories_archived_at ON categories(archived_at);

    -- Many-to-many join. Picking a goal in the renderer auto-suggests
    -- its associated categories. ON DELETE CASCADE keeps the table
    -- consistent when a goal or category is hard-deleted (delete,
    -- not archive).
    CREATE TABLE IF NOT EXISTS goal_categories (
      goal_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (goal_id, category_id),
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_goal_categories_category_id
      ON goal_categories(category_id);
  `);

  // Phase B.1: add nullable category_id / goal_id columns to the
  // existing notifications table. SQLite does NOT support
  // `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so we probe
  // pragma_table_info first and ALTER only when missing. This keeps
  // upgrades from older Harbor builds safe and idempotent.
  addColumnIfMissing(conn, 'notifications', 'category_id', 'TEXT');
  addColumnIfMissing(conn, 'notifications', 'goal_id', 'TEXT');
  conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_notifications_category_id
      ON notifications(category_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_goal_id
      ON notifications(goal_id);
  `);

  seedDefaultCategoriesIfEmpty(conn);
}

function addColumnIfMissing(
  conn: Database.Database,
  table: string,
  column: string,
  decl: string,
): void {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some(c => c.name === column)) return;
  // Inline `decl` is a constant from our own code, not user input, so
  // string interpolation is safe here (sqlite refuses parameter
  // binding inside DDL anyway).
  conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

/**
 * One-time seed: if `categories` is empty, insert Chris's default
 * working categories. Detected by COUNT(*) so a user who archives or
 * deletes every default won't have them reappear.
 */
function seedDefaultCategoriesIfEmpty(conn: Database.Database): void {
  const row = conn.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number };
  if (row.n > 0) return;
  const now = new Date().toISOString();
  const stmt = conn.prepare(
    `INSERT INTO categories
       (id, title, description, color, sort_order, archived_at, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, NULL, ?, ?)`,
  );
  const seeds: Array<{ title: string; color: string }> = [
    { title: 'Dual Access', color: '#F59E0B' },
    { title: 'SDK Partners', color: '#3B82F6' },
    { title: 'AI Workstream', color: '#10B981' },
    { title: 'Personal / Admin', color: '#8B5CF6' },
    { title: 'Other', color: '#6B7280' },
  ];
  const tx = conn.transaction(() => {
    for (let i = 0; i < seeds.length; i++) {
      stmt.run(crypto.randomUUID(), seeds[i].title, seeds[i].color, i, now, now);
    }
  });
  tx();
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

// ---------------------------------------------------------------------------
// Goals (Phase B.1)
// ---------------------------------------------------------------------------

const GOAL_COLS =
  'id, title, description, color, sort_order, archived_at, created_at, updated_at';

export function createGoal(input: CreateGoalInput): Goal {
  const conn = requireDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const color = input.color ?? DEFAULT_GOAL_COLOR;
  const description = input.description ?? null;
  const sortOrder = input.sort_order ?? nextSortOrder(conn, 'goals');
  conn
    .prepare(
      `INSERT INTO goals (${GOAL_COLS})
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(id, input.title, description, color, sortOrder, now, now);
  return getGoal(id) as Goal;
}

export function listGoals(filter: ListGoalsFilter = {}): Goal[] {
  const conn = requireDb();
  const sql = filter.includeArchived
    ? `SELECT ${GOAL_COLS} FROM goals ORDER BY sort_order ASC, created_at ASC`
    : `SELECT ${GOAL_COLS} FROM goals
         WHERE archived_at IS NULL
         ORDER BY sort_order ASC, created_at ASC`;
  return conn.prepare(sql).all() as Goal[];
}

export function getGoal(id: string): Goal | null {
  const row = requireDb()
    .prepare(`SELECT ${GOAL_COLS} FROM goals WHERE id = ?`)
    .get(id) as Goal | undefined;
  return row ?? null;
}

export function updateGoal(id: string, patch: UpdateGoalPatch): Goal | null {
  const conn = requireDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    fields.push('title = ?');
    values.push(patch.title);
  }
  if (patch.description !== undefined) {
    fields.push('description = ?');
    values.push(patch.description);
  }
  if (patch.color !== undefined) {
    fields.push('color = ?');
    values.push(patch.color);
  }
  if (patch.sort_order !== undefined) {
    fields.push('sort_order = ?');
    values.push(patch.sort_order);
  }
  if (fields.length === 0) return getGoal(id);
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  conn.prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getGoal(id);
}

export function archiveGoal(id: string): boolean {
  const now = new Date().toISOString();
  const info = requireDb()
    .prepare('UPDATE goals SET archived_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, id);
  return info.changes > 0;
}

export function unarchiveGoal(id: string): boolean {
  const now = new Date().toISOString();
  const info = requireDb()
    .prepare('UPDATE goals SET archived_at = NULL, updated_at = ? WHERE id = ?')
    .run(now, id);
  return info.changes > 0;
}

export function deleteGoal(id: string): boolean {
  const info = requireDb().prepare('DELETE FROM goals WHERE id = ?').run(id);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Categories (Phase B.1)
// ---------------------------------------------------------------------------

const CATEGORY_COLS =
  'id, title, description, color, sort_order, archived_at, created_at, updated_at';

export function createCategory(input: CreateCategoryInput): Category {
  const conn = requireDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const color = input.color ?? DEFAULT_CATEGORY_COLOR;
  const description = input.description ?? null;
  const sortOrder = input.sort_order ?? nextSortOrder(conn, 'categories');
  conn
    .prepare(
      `INSERT INTO categories (${CATEGORY_COLS})
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(id, input.title, description, color, sortOrder, now, now);
  return getCategory(id) as Category;
}

export function listCategories(filter: ListCategoriesFilter = {}): Category[] {
  const conn = requireDb();
  const sql = filter.includeArchived
    ? `SELECT ${CATEGORY_COLS} FROM categories ORDER BY sort_order ASC, created_at ASC`
    : `SELECT ${CATEGORY_COLS} FROM categories
         WHERE archived_at IS NULL
         ORDER BY sort_order ASC, created_at ASC`;
  return conn.prepare(sql).all() as Category[];
}

export function getCategory(id: string): Category | null {
  const row = requireDb()
    .prepare(`SELECT ${CATEGORY_COLS} FROM categories WHERE id = ?`)
    .get(id) as Category | undefined;
  return row ?? null;
}

export function updateCategory(id: string, patch: UpdateCategoryPatch): Category | null {
  const conn = requireDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    fields.push('title = ?');
    values.push(patch.title);
  }
  if (patch.description !== undefined) {
    fields.push('description = ?');
    values.push(patch.description);
  }
  if (patch.color !== undefined) {
    fields.push('color = ?');
    values.push(patch.color);
  }
  if (patch.sort_order !== undefined) {
    fields.push('sort_order = ?');
    values.push(patch.sort_order);
  }
  if (fields.length === 0) return getCategory(id);
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  conn.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getCategory(id);
}

export function archiveCategory(id: string): boolean {
  const now = new Date().toISOString();
  const info = requireDb()
    .prepare('UPDATE categories SET archived_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, id);
  return info.changes > 0;
}

export function unarchiveCategory(id: string): boolean {
  const now = new Date().toISOString();
  const info = requireDb()
    .prepare('UPDATE categories SET archived_at = NULL, updated_at = ? WHERE id = ?')
    .run(now, id);
  return info.changes > 0;
}

export function deleteCategory(id: string): boolean {
  const info = requireDb().prepare('DELETE FROM categories WHERE id = ?').run(id);
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Goal ↔ Category associations (Phase B.1)
// ---------------------------------------------------------------------------

/** Insert is idempotent (`INSERT OR IGNORE`) so callers can re-link safely. */
export function associateGoalCategory(goalId: string, categoryId: string): boolean {
  const conn = requireDb();
  const now = new Date().toISOString();
  const info = conn
    .prepare(
      `INSERT OR IGNORE INTO goal_categories (goal_id, category_id, created_at)
       VALUES (?, ?, ?)`,
    )
    .run(goalId, categoryId, now);
  if (info.changes > 0) {
    conn.prepare('UPDATE goals SET updated_at = ? WHERE id = ?').run(now, goalId);
  }
  return info.changes > 0;
}

export function disassociateGoalCategory(goalId: string, categoryId: string): boolean {
  const conn = requireDb();
  const info = conn
    .prepare('DELETE FROM goal_categories WHERE goal_id = ? AND category_id = ?')
    .run(goalId, categoryId);
  if (info.changes > 0) {
    const now = new Date().toISOString();
    conn.prepare('UPDATE goals SET updated_at = ? WHERE id = ?').run(now, goalId);
  }
  return info.changes > 0;
}

/** Categories linked to a goal. Excludes archived categories by default. */
export function listCategoriesForGoal(
  goalId: string,
  opts: { includeArchived?: boolean } = {},
): Category[] {
  const conn = requireDb();
  const sql = opts.includeArchived
    ? `SELECT c.id, c.title, c.description, c.color, c.sort_order, c.archived_at,
              c.created_at, c.updated_at
         FROM categories c
         JOIN goal_categories gc ON gc.category_id = c.id
        WHERE gc.goal_id = ?
        ORDER BY c.sort_order ASC, c.created_at ASC`
    : `SELECT c.id, c.title, c.description, c.color, c.sort_order, c.archived_at,
              c.created_at, c.updated_at
         FROM categories c
         JOIN goal_categories gc ON gc.category_id = c.id
        WHERE gc.goal_id = ? AND c.archived_at IS NULL
        ORDER BY c.sort_order ASC, c.created_at ASC`;
  return conn.prepare(sql).all(goalId) as Category[];
}

/** Reverse lookup: which goals reference this category. */
export function listGoalsForCategory(
  categoryId: string,
  opts: { includeArchived?: boolean } = {},
): Goal[] {
  const conn = requireDb();
  const sql = opts.includeArchived
    ? `SELECT g.id, g.title, g.description, g.color, g.sort_order, g.archived_at,
              g.created_at, g.updated_at
         FROM goals g
         JOIN goal_categories gc ON gc.goal_id = g.id
        WHERE gc.category_id = ?
        ORDER BY g.sort_order ASC, g.created_at ASC`
    : `SELECT g.id, g.title, g.description, g.color, g.sort_order, g.archived_at,
              g.created_at, g.updated_at
         FROM goals g
         JOIN goal_categories gc ON gc.goal_id = g.id
        WHERE gc.category_id = ? AND g.archived_at IS NULL
        ORDER BY g.sort_order ASC, g.created_at ASC`;
  return conn.prepare(sql).all(categoryId) as Goal[];
}

function nextSortOrder(conn: Database.Database, table: 'goals' | 'categories'): number {
  const row = conn
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM ${table}`)
    .get() as { next: number };
  return row.next;
}
