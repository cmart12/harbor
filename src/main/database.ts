import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import initSqlJs, { Database } from 'sql.js';
import { v4 as uuidv4 } from 'uuid';
import { Intent, CreateIntentInput } from '../shared/types';

let db: Database;

const DB_PATH = path.join(app.getPath('userData'), 'intents.db');

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();

  let fileBuffer: Buffer | undefined;
  try {
    if (fs.existsSync(DB_PATH)) {
      fileBuffer = fs.readFileSync(DB_PATH);
    }
    db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();
  } catch (err) {
    console.error('Failed to load database, creating fresh:', err);
    db = new SQL.Database();
  }

  db.run(`
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

  saveDatabase();
}

function saveDatabase(): void {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('Failed to save database:', err);
  }
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

  db.run(
    `INSERT INTO intents (id, description, client, due_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [intent.id, intent.description, intent.client, intent.due_at, intent.status, intent.created_at, intent.updated_at]
  );

  saveDatabase();
  return intent;
}

export function listIntents(): Intent[] {
  const results = db.exec(
    `SELECT id, description, client, due_at, status, created_at, updated_at
     FROM intents ORDER BY created_at DESC`
  );

  if (results.length === 0) return [];

  return results[0].values.map((row) => ({
    id: row[0] as string,
    description: row[1] as string,
    client: row[2] as string | null,
    due_at: row[3] as string | null,
    status: row[4] as Intent['status'],
    created_at: row[5] as string,
    updated_at: row[6] as string,
  }));
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
  db.run(`UPDATE intents SET ${fields.join(', ')} WHERE id = ?`, values);
  saveDatabase();

  const result = db.exec(`SELECT id, description, client, due_at, status, created_at, updated_at FROM intents WHERE id = ?`, [id]);
  if (result.length === 0 || result[0].values.length === 0) return null;

  const row = result[0].values[0];
  return {
    id: row[0] as string,
    description: row[1] as string,
    client: row[2] as string | null,
    due_at: row[3] as string | null,
    status: row[4] as Intent['status'],
    created_at: row[5] as string,
    updated_at: row[6] as string,
  };
}

export function deleteIntent(id: string): boolean {
  const before = db.exec(`SELECT COUNT(*) FROM intents WHERE id = ?`, [id]);
  const count = before[0]?.values[0]?.[0] as number;
  if (count === 0) return false;

  db.run(`DELETE FROM intents WHERE id = ?`, [id]);
  saveDatabase();
  return true;
}
