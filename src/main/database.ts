import * as path from 'path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Intent, CreateIntentInput } from '../shared/types';

let db: Database.Database;

const DB_PATH = path.join(app.getPath('userData'), 'intents.db');

export function initDatabase(): void {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      raw_text TEXT,
      client TEXT,
      due_at TEXT,
      status TEXT NOT NULL DEFAULT 'captured',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Migrations: add columns if missing (existing DBs)
  const columns = db.prepare(`PRAGMA table_info(intents)`).all() as { name: string }[];
  const has = (name: string) => columns.some(c => c.name === name);

  if (!has('raw_text'))     db.exec(`ALTER TABLE intents ADD COLUMN raw_text TEXT`);
  if (!has('due_at_utc'))   db.exec(`ALTER TABLE intents ADD COLUMN due_at_utc TEXT`);
  if (!has('recurrence'))   db.exec(`ALTER TABLE intents ADD COLUMN recurrence TEXT`);
  if (!has('completed_at')) db.exec(`ALTER TABLE intents ADD COLUMN completed_at TEXT`);
  if (!has('session_id'))   db.exec(`ALTER TABLE intents ADD COLUMN session_id TEXT`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS intent_events (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      due_at TEXT,
      due_at_utc TEXT,
      completed_at TEXT,
      recurrence_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (intent_id) REFERENCES intents(id) ON DELETE CASCADE
    )
  `);
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function createIntent(input: CreateIntentInput): Intent {
  const now = new Date().toISOString();
  const intent: Intent = {
    id: uuidv4(),
    description: input.description,
    raw_text: input.description,
    client: input.client || null,
    due_at: input.due_at || null,
    due_at_utc: null,
    recurrence: null,
    completed_at: null,
    session_id: null,
    status: 'captured',
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO intents (id, description, raw_text, client, due_at, due_at_utc, recurrence, completed_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(intent.id, intent.description, intent.raw_text, intent.client, intent.due_at, intent.due_at_utc, intent.recurrence, intent.completed_at, intent.status, intent.created_at, intent.updated_at);

  return intent;
}

export function getIntent(id: string): Intent | null {
  return db.prepare(
    `SELECT id, description, raw_text, client, due_at, due_at_utc, recurrence, completed_at, session_id, status, created_at, updated_at
     FROM intents WHERE id = ?`
  ).get(id) as Intent | undefined ?? null;
}

export function listIntents(): Intent[] {
  return db.prepare(
    `SELECT id, description, raw_text, client, due_at, due_at_utc, recurrence, completed_at, session_id, status, created_at, updated_at
     FROM intents
     ORDER BY
       CASE WHEN status = 'done' THEN 1 ELSE 0 END ASC,
       CASE WHEN status = 'in_progress' THEN 0 ELSE 1 END ASC,
       CASE WHEN due_at_utc IS NOT NULL THEN 0 ELSE 1 END ASC,
       due_at_utc ASC,
       updated_at DESC`
  ).all() as Intent[];
}

export function updateIntent(id: string, updates: Partial<Pick<Intent, 'description' | 'client' | 'due_at' | 'due_at_utc' | 'recurrence' | 'completed_at' | 'status'>>): Intent | null {
  const now = new Date().toISOString();
  const fields: string[] = ['updated_at = ?'];
  const values: (string | null)[] = [now];

  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.client !== undefined) { fields.push('client = ?'); values.push(updates.client); }
  if (updates.due_at !== undefined) { fields.push('due_at = ?'); values.push(updates.due_at); }
  if (updates.due_at_utc !== undefined) { fields.push('due_at_utc = ?'); values.push(updates.due_at_utc); }
  if (updates.recurrence !== undefined) { fields.push('recurrence = ?'); values.push(updates.recurrence); }
  if (updates.completed_at !== undefined) { fields.push('completed_at = ?'); values.push(updates.completed_at); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }

  values.push(id);
  db.prepare(`UPDATE intents SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return getIntent(id);
}

/** Compare-and-swap update: only applies if updated_at matches expectedVersion */
export function updateIntentCAS(id: string, expectedVersion: string, updates: Partial<Pick<Intent, 'description' | 'client' | 'due_at' | 'due_at_utc' | 'recurrence' | 'completed_at' | 'status'>>): Intent | null {
  const now = new Date().toISOString();
  const fields: string[] = ['updated_at = ?'];
  const values: (string | null)[] = [now];

  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.client !== undefined) { fields.push('client = ?'); values.push(updates.client); }
  if (updates.due_at !== undefined) { fields.push('due_at = ?'); values.push(updates.due_at); }
  if (updates.due_at_utc !== undefined) { fields.push('due_at_utc = ?'); values.push(updates.due_at_utc); }
  if (updates.recurrence !== undefined) { fields.push('recurrence = ?'); values.push(updates.recurrence); }
  if (updates.completed_at !== undefined) { fields.push('completed_at = ?'); values.push(updates.completed_at); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }

  values.push(id, expectedVersion);
  const result = db.prepare(`UPDATE intents SET ${fields.join(', ')} WHERE id = ? AND updated_at = ?`).run(...values);

  if (result.changes === 0) return null; // CAS failed — row was modified
  return getIntent(id);
}

export function logIntentEvent(intentId: string, eventType: string, data: { due_at?: string | null; due_at_utc?: string | null; completed_at?: string | null; recurrence_json?: string | null } = {}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO intent_events (id, intent_id, event_type, due_at, due_at_utc, completed_at, recurrence_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uuidv4(), intentId, eventType, data.due_at ?? null, data.due_at_utc ?? null, data.completed_at ?? null, data.recurrence_json ?? null, now);
}

export interface IntentEvent {
  id: string;
  intent_id: string;
  event_type: string;
  due_at: string | null;
  due_at_utc: string | null;
  completed_at: string | null;
  recurrence_json: string | null;
  created_at: string;
  intent_description: string | null;
  intent_client: string | null;
  session_id: string | null;
}

/** List intent events with joined intent info, most recent first */
export function listIntentEvents(limit = 100): IntentEvent[] {
  return db.prepare(
    `SELECT e.id, e.intent_id, e.event_type, e.due_at, e.due_at_utc, e.completed_at, e.recurrence_json, e.created_at,
            i.description AS intent_description, i.client AS intent_client, i.session_id
     FROM intent_events e
     LEFT JOIN intents i ON e.intent_id = i.id
     ORDER BY e.created_at DESC
     LIMIT ?`
  ).all(limit) as IntentEvent[];
}

/** Set session_id on an intent (main-process only, not exposed via generic update) */
export function setIntentSessionId(intentId: string, sessionId: string): void {
  db.prepare(`UPDATE intents SET session_id = ?, updated_at = ? WHERE id = ?`)
    .run(sessionId, new Date().toISOString(), intentId);
}

export function deleteIntent(id: string): boolean {
  const result = db.prepare(`DELETE FROM intents WHERE id = ?`).run(id);
  return result.changes > 0;
}
