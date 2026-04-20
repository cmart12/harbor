import * as fs from 'fs';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Intent, CreateIntentInput } from '../shared/types';
import { appendEvent, replayLog } from './eventlog';

let db: Database.Database;
let logPath: string;

export function isInitialized(): boolean {
  return db !== undefined;
}

export function getDatabase(): Database.Database {
  return db;
}

/**
 * Initialize a fresh database at the given path (inside the workspace .intent/ dir).
 * Deletes any existing DB first — the log is the source of truth.
 */
export function initDatabase(dbPath: string, eventLogPath: string): void {
  // Always start fresh — DB is a derived cache
  for (const f of [dbPath, dbPath + '-journal', dbPath + '-wal', dbPath + '-shm']) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = DELETE');
  logPath = eventLogPath;

  db.exec(`
    CREATE TABLE intents (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      raw_text TEXT,
      client TEXT,
      due_at TEXT,
      due_at_utc TEXT,
      recurrence TEXT,
      completed_at TEXT,
      folder TEXT,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'captured',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE intent_events (
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

  // Rebuild state from event log
  replayLog(eventLogPath, db);
}

/** Inject per-machine session IDs from local config into the DB after replay. */
export function mergeSessionIds(sessions: Record<string, string>): void {
  const stmt = db.prepare('UPDATE intents SET session_id = ? WHERE id = ?');
  for (const [intentId, sessionId] of Object.entries(sessions)) {
    stmt.run(sessionId, intentId);
  }
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
    folder: null,
    session_id: null,
    status: 'captured',
    created_at: now,
    updated_at: now,
  };

  // Log first — the event log is authoritative
  appendEvent(logPath, 'intent.create', {
    id: intent.id,
    description: intent.description,
    raw_text: intent.raw_text,
    client: intent.client,
    due_at: intent.due_at,
    due_at_utc: intent.due_at_utc,
    recurrence: intent.recurrence,
    completed_at: intent.completed_at,
    folder: intent.folder,
    status: intent.status,
    created_at: intent.created_at,
    updated_at: intent.updated_at,
  });

  db.prepare(
    `INSERT INTO intents (id, description, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, session_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(intent.id, intent.description, intent.raw_text, intent.client, intent.due_at, intent.due_at_utc, intent.recurrence, intent.completed_at, intent.folder, intent.session_id, intent.status, intent.created_at, intent.updated_at);

  return intent;
}

export function getIntent(id: string): Intent | null {
  return db.prepare(
    `SELECT id, description, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, session_id, status, created_at, updated_at
     FROM intents WHERE id = ?`
  ).get(id) as Intent | undefined ?? null;
}

export function listIntents(): Intent[] {
  return db.prepare(
    `SELECT id, description, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, session_id, status, created_at, updated_at
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
  const fields: Record<string, string | null> = { updated_at: now };

  if (updates.description !== undefined) fields.description = updates.description;
  if (updates.client !== undefined) fields.client = updates.client;
  if (updates.due_at !== undefined) fields.due_at = updates.due_at;
  if (updates.due_at_utc !== undefined) fields.due_at_utc = updates.due_at_utc;
  if (updates.recurrence !== undefined) fields.recurrence = updates.recurrence;
  if (updates.completed_at !== undefined) fields.completed_at = updates.completed_at;
  if (updates.status !== undefined) fields.status = updates.status;

  // Log first
  appendEvent(logPath, 'intent.update', { id, fields });

  const sets = Object.keys(fields).map(k => `${k} = ?`);
  const values = [...Object.values(fields), id];
  db.prepare(`UPDATE intents SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  return getIntent(id);
}

/** Compare-and-swap update: only applies if updated_at matches expectedVersion. */
export function updateIntentCAS(id: string, expectedVersion: string, updates: Partial<Pick<Intent, 'description' | 'client' | 'due_at' | 'due_at_utc' | 'recurrence' | 'completed_at' | 'status'>>): Intent | null {
  const current = getIntent(id);
  if (!current || current.updated_at !== expectedVersion) return null;
  return updateIntent(id, updates);
}

/** Assign a workspace folder to an intent. Logged as a dedicated event. */
export function assignIntentFolder(intentId: string, folder: string): void {
  appendEvent(logPath, 'intent.assign_folder', { id: intentId, folder });
  const now = new Date().toISOString();
  db.prepare('UPDATE intents SET folder = ?, updated_at = ? WHERE id = ?')
    .run(folder, now, intentId);
}

export function logIntentEvent(intentId: string, eventType: string, data: { due_at?: string | null; due_at_utc?: string | null; completed_at?: string | null; recurrence_json?: string | null } = {}): void {
  const now = new Date().toISOString();
  const eventId = uuidv4();

  appendEvent(logPath, 'intent_event.log', {
    id: eventId,
    intent_id: intentId,
    event_type: eventType,
    due_at: data.due_at ?? null,
    due_at_utc: data.due_at_utc ?? null,
    completed_at: data.completed_at ?? null,
    recurrence_json: data.recurrence_json ?? null,
    created_at: now,
  });

  db.prepare(
    `INSERT INTO intent_events (id, intent_id, event_type, due_at, due_at_utc, completed_at, recurrence_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(eventId, intentId, eventType, data.due_at ?? null, data.due_at_utc ?? null, data.completed_at ?? null, data.recurrence_json ?? null, now);
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

/** Set session_id on an intent — local only, not logged (per-machine). */
export function setIntentSessionId(intentId: string, sessionId: string): void {
  db.prepare('UPDATE intents SET session_id = ? WHERE id = ?')
    .run(sessionId, intentId);
}

export function deleteIntent(id: string): boolean {
  appendEvent(logPath, 'intent.delete', { id });
  const result = db.prepare('DELETE FROM intents WHERE id = ?').run(id);
  return result.changes > 0;
}
