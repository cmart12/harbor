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
      client TEXT,
      due_at TEXT,
      status TEXT NOT NULL DEFAULT 'captured',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

export function createIntent(input: CreateIntentInput): Intent {
  const now = new Date().toISOString();
  const intent: Intent = {
    id: uuidv4(),
    description: input.description,
    client: input.client || null,
    due_at: input.due_at || null,
    status: 'captured',
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO intents (id, description, client, due_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(intent.id, intent.description, intent.client, intent.due_at, intent.status, intent.created_at, intent.updated_at);

  return intent;
}

export function listIntents(): Intent[] {
  return db.prepare(
    `SELECT id, description, client, due_at, status, created_at, updated_at
     FROM intents ORDER BY created_at DESC`
  ).all() as Intent[];
}

export function updateIntent(id: string, updates: Partial<Pick<Intent, 'description' | 'client' | 'due_at' | 'status'>>): Intent | null {
  const now = new Date().toISOString();
  const fields: string[] = ['updated_at = ?'];
  const values: (string | null)[] = [now];

  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.client !== undefined) { fields.push('client = ?'); values.push(updates.client); }
  if (updates.due_at !== undefined) { fields.push('due_at = ?'); values.push(updates.due_at); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }

  values.push(id);
  db.prepare(`UPDATE intents SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return db.prepare(
    `SELECT id, description, client, due_at, status, created_at, updated_at FROM intents WHERE id = ?`
  ).get(id) as Intent | undefined ?? null;
}

export function deleteIntent(id: string): boolean {
  const result = db.prepare(`DELETE FROM intents WHERE id = ?`).run(id);
  return result.changes > 0;
}
