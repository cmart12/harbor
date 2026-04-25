import * as fs from 'fs';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Intent, Attachment, CanvasAgent, AgentSession, CreateIntentInput } from '../shared/types';
import { appendEvent, replayLog } from './eventlog';
import { readCanvas } from './workspace';

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
      body TEXT,
      raw_text TEXT,
      client TEXT,
      due_at TEXT,
      due_at_utc TEXT,
      recurrence TEXT,
      completed_at TEXT,
      folder TEXT,
      session_id TEXT,
      attachments TEXT DEFAULT '[]',
      canvas_content TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'captured',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE canvas_agents (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL,
      selected_text TEXT NOT NULL,
      session_id TEXT NOT NULL,
      pid INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (intent_id) REFERENCES intents(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      intent_id TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      summary TEXT DEFAULT '',
      working_dir TEXT,
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

function parseAttachments(raw: string | null | undefined): Attachment[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function createIntent(input: CreateIntentInput): Intent {
  const now = new Date().toISOString();
  // Placeholder title: first line or first ~80 chars of body
  const firstLine = input.body.split('\n')[0].trim();
  const placeholder = firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine;

  const intent: Intent = {
    id: uuidv4(),
    description: placeholder,
    body: input.body,
    raw_text: input.body,
    client: null,
    due_at: null,
    due_at_utc: null,
    recurrence: null,
    completed_at: null,
    folder: null,
    session_id: null,
    attachments: [],
    status: 'captured',
    created_at: now,
    updated_at: now,
  };

  // Log first — the event log is authoritative
  appendEvent(logPath, 'intent.create', {
    id: intent.id,
    description: intent.description,
    body: intent.body,
    raw_text: intent.raw_text,
    client: intent.client,
    due_at: intent.due_at,
    due_at_utc: intent.due_at_utc,
    recurrence: intent.recurrence,
    completed_at: intent.completed_at,
    folder: intent.folder,
    attachments: JSON.stringify(intent.attachments),
    status: intent.status,
    created_at: intent.created_at,
    updated_at: intent.updated_at,
  });

  db.prepare(
    `INSERT INTO intents (id, description, body, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, session_id, attachments, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(intent.id, intent.description, intent.body, intent.raw_text, intent.client, intent.due_at, intent.due_at_utc, intent.recurrence, intent.completed_at, intent.folder, intent.session_id, JSON.stringify(intent.attachments), intent.status, intent.created_at, intent.updated_at);

  return intent;
}

export function getIntent(id: string): Intent | null {
  const row = db.prepare(
    `SELECT id, description, body, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, session_id, attachments, status, created_at, updated_at
     FROM intents WHERE id = ?`
  ).get(id) as any | undefined;
  if (!row) return null;
  return { ...row, attachments: parseAttachments(row.attachments) };
}

export function listIntents(): Intent[] {
  const rows = db.prepare(
    `SELECT id, description, body, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, session_id, attachments, status, created_at, updated_at
     FROM intents
     ORDER BY
       CASE WHEN status = 'done' THEN 1 ELSE 0 END ASC,
       CASE WHEN status = 'in_progress' THEN 0 ELSE 1 END ASC,
       CASE WHEN due_at_utc IS NOT NULL THEN 0 ELSE 1 END ASC,
       due_at_utc ASC,
       updated_at DESC`
  ).all() as any[];
  return rows.map(r => ({ ...r, attachments: parseAttachments(r.attachments) }));
}

export function updateIntent(id: string, updates: Partial<Pick<Intent, 'description' | 'body' | 'client' | 'due_at' | 'due_at_utc' | 'recurrence' | 'completed_at' | 'status' | 'attachments'>>): Intent | null {
  const now = new Date().toISOString();
  const fields: Record<string, string | null> = { updated_at: now };

  if (updates.description !== undefined) fields.description = updates.description;
  if (updates.body !== undefined) fields.body = updates.body;
  if (updates.client !== undefined) fields.client = updates.client;
  if (updates.due_at !== undefined) fields.due_at = updates.due_at;
  if (updates.due_at_utc !== undefined) fields.due_at_utc = updates.due_at_utc;
  if (updates.recurrence !== undefined) fields.recurrence = updates.recurrence;
  if (updates.completed_at !== undefined) fields.completed_at = updates.completed_at;
  if (updates.status !== undefined) fields.status = updates.status;
  if (updates.attachments !== undefined) fields.attachments = JSON.stringify(updates.attachments);

  // Log first
  appendEvent(logPath, 'intent.update', { id, fields });

  const sets = Object.keys(fields).map(k => `${k} = ?`);
  const values = [...Object.values(fields), id];
  db.prepare(`UPDATE intents SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  return getIntent(id);
}

/** Compare-and-swap update: only applies if updated_at matches expectedVersion. */
export function updateIntentCAS(id: string, expectedVersion: string, updates: Partial<Pick<Intent, 'description' | 'body' | 'client' | 'due_at' | 'due_at_utc' | 'recurrence' | 'completed_at' | 'status' | 'attachments'>>): Intent | null {
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

/** Read all canvas files from disk and populate the canvas_content column. */
export function syncCanvasContent(workspaceRoot: string): void {
  const rows = db.prepare('SELECT id, folder FROM intents WHERE folder IS NOT NULL').all() as { id: string; folder: string }[];
  const stmt = db.prepare('UPDATE intents SET canvas_content = ? WHERE id = ?');
  for (const row of rows) {
    try {
      const content = readCanvas(workspaceRoot, row.folder);
      stmt.run(content, row.id);
    } catch { /* folder may not exist yet */ }
  }
}

/** Update the cached canvas content for a single intent. */
export function updateCanvasContent(intentId: string, content: string): void {
  db.prepare('UPDATE intents SET canvas_content = ? WHERE id = ?').run(content, intentId);
}

/** Search intents by description, body, or canvas content. */
export function searchIntents(query: string): Intent[] {
  const like = `%${query}%`;
  const rows = db.prepare(
    `SELECT id, description, body, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, session_id, attachments, status, created_at, updated_at
     FROM intents
     WHERE description LIKE ? OR body LIKE ? OR canvas_content LIKE ?
     ORDER BY updated_at DESC`
  ).all(like, like, like) as any[];
  return rows.map(r => ({ ...r, attachments: parseAttachments(r.attachments) }));
}

// ── Canvas Agents ─────────────────────────────────────────

export function createCanvasAgent(agent: CanvasAgent): void {
  appendEvent(logPath, 'canvas_agent.created', {
    id: agent.id,
    intent_id: agent.intent_id,
    selected_text: agent.selected_text,
    session_id: agent.session_id,
    pid: agent.pid,
    status: agent.status,
    created_at: agent.created_at,
    updated_at: agent.updated_at,
  });

  db.prepare(
    `INSERT INTO canvas_agents (id, intent_id, selected_text, session_id, pid, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(agent.id, agent.intent_id, agent.selected_text, agent.session_id, agent.pid, agent.status, agent.created_at, agent.updated_at);
}

export function updateCanvasAgentStatus(id: string, status: 'running' | 'waiting-approval' | 'completed' | 'failed', pid?: number | null): void {
  const now = new Date().toISOString();
  appendEvent(logPath, 'canvas_agent.updated', { id, status, pid: pid ?? null, updated_at: now });
  const updates: any[] = [status, now];
  let sql = 'UPDATE canvas_agents SET status = ?, updated_at = ?';
  if (pid !== undefined) {
    sql += ', pid = ?';
    updates.push(pid);
  }
  sql += ' WHERE id = ?';
  updates.push(id);
  db.prepare(sql).run(...updates);
}

export function listCanvasAgents(intentId: string): CanvasAgent[] {
  return db.prepare(
    `SELECT id, intent_id, selected_text, session_id, pid, status, created_at, updated_at
     FROM canvas_agents WHERE intent_id = ? ORDER BY created_at DESC`
  ).all(intentId) as CanvasAgent[];
}

export function listAllRunningAgents(): CanvasAgent[] {
  return db.prepare(
    `SELECT id, intent_id, selected_text, session_id, pid, status, created_at, updated_at
     FROM canvas_agents WHERE status = 'running'`
  ).all() as CanvasAgent[];
}

// ── Agent Sessions (central registry) ─────────────────────

export function createAgentSession(session: AgentSession): void {
  appendEvent(logPath, 'agent_session.created', {
    id: session.id,
    session_id: session.session_id,
    intent_id: session.intent_id,
    prompt: session.prompt,
    status: session.status,
    summary: session.summary,
    working_dir: session.working_dir,
    created_at: session.created_at,
    updated_at: session.updated_at,
  });

  db.prepare(
    `INSERT INTO agent_sessions (id, session_id, intent_id, prompt, status, summary, working_dir, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    session.id, session.session_id, session.intent_id, session.prompt,
    session.status, session.summary, session.working_dir,
    session.created_at, session.updated_at,
  );
}

export function updateAgentSessionStatus(id: string, status: string, summary?: string): void {
  const now = new Date().toISOString();
  appendEvent(logPath, 'agent_session.updated', { id, status, summary: summary ?? null, updated_at: now });

  if (summary !== undefined) {
    db.prepare('UPDATE agent_sessions SET status = ?, summary = ?, updated_at = ? WHERE id = ?')
      .run(status, summary, now, id);
  } else {
    db.prepare('UPDATE agent_sessions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id);
  }
}

export function getAgentSession(id: string): AgentSession | null {
  return db.prepare(
    `SELECT id, session_id, intent_id, prompt, status, summary, working_dir, created_at, updated_at
     FROM agent_sessions WHERE id = ?`
  ).get(id) as AgentSession | undefined ?? null;
}

export function listAgentSessions(): AgentSession[] {
  return db.prepare(
    `SELECT id, session_id, intent_id, prompt, status, summary, working_dir, created_at, updated_at
     FROM agent_sessions ORDER BY created_at DESC`
  ).all() as AgentSession[];
}
