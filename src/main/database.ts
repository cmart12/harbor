import * as fs from 'fs';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Space, Attachment, CanvasAgent, AgentSession, AgentChatEvent, CreateSpaceInput, Skill, SkillFrontmatter } from '../shared/types';
import { appendEvent, replayLog } from './eventlog';
import { readCanvas, slugify } from './workspace';

let db: Database.Database;
let logPath: string;

export function isInitialized(): boolean {
  return db !== undefined;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = undefined as any;
    logPath = '';
  }
}

export function getDatabase(): Database.Database {
  return db;
}

/**
 * Initialize a fresh database at the given path (inside the workspace .whim/ dir).
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
    CREATE TABLE spaces (
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
      source_skill_id TEXT,
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
      space_id TEXT NOT NULL,
      selected_text TEXT NOT NULL,
      session_id TEXT NOT NULL,
      pid INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      space_id TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      summary TEXT DEFAULT '',
      working_dir TEXT,
      source TEXT NOT NULL DEFAULT 'sdk',
      persona_handle TEXT,
      quoted_text TEXT,
      run_location TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE agent_chat_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      event_id TEXT,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payload TEXT NOT NULL,
      UNIQUE(agent_id, seq)
    )
  `);
  db.exec('CREATE INDEX idx_agent_chat_events_agent_seq ON agent_chat_events(agent_id, seq)');

  db.exec(`
    CREATE TABLE space_events (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      due_at TEXT,
      due_at_utc TEXT,
      completed_at TEXT,
      recurrence_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '🧩',
      folder_path TEXT NOT NULL,
      file_path TEXT NOT NULL,
      schedule TEXT,
      schedule_time TEXT,
      schedule_day INTEGER,
      next_run_at TEXT,
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS subagent_records (
      id TEXT PRIMARY KEY,
      parent_agent_id TEXT NOT NULL,
      tool_call_id TEXT,
      agent_name TEXT NOT NULL,
      display_name TEXT,
      description TEXT,
      agent_type TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      duration_ms INTEGER,
      model TEXT,
      total_tokens INTEGER,
      total_tool_calls INTEGER,
      error TEXT,
      streaming_content TEXT DEFAULT '',
      turns_json TEXT DEFAULT '[]',
      progress_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS subagent_tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subagent_id TEXT NOT NULL,
      parent_agent_id TEXT NOT NULL,
      tool_call_id TEXT,
      tool_name TEXT NOT NULL,
      arguments_json TEXT,
      result TEXT,
      success INTEGER DEFAULT 1,
      error TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (subagent_id) REFERENCES subagent_records(id)
    )
  `);

  // Rebuild state from event log
  replayLog(eventLogPath, db);
}

/** Inject per-machine session IDs from local config into the DB after replay. */
export function mergeSessionIds(sessions: Record<string, string>): void {
  const stmt = db.prepare('UPDATE spaces SET session_id = ? WHERE id = ?');
  for (const [spaceId, sessionId] of Object.entries(sessions)) {
    stmt.run(sessionId, spaceId);
  }
}

function parseAttachments(raw: string | null | undefined): Attachment[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function createSpace(input: CreateSpaceInput, sourceSkillId?: string): Space {
  const now = new Date().toISOString();
  const id = uuidv4();
  // Placeholder title: first line or first ~80 chars of body
  const firstLine = input.body.split('\n')[0].trim();
  const placeholder = firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine;
  // Folder slug is deterministic from id + description, so we can record it in
  // the create event up front and defer the actual on-disk folder creation.
  const folder = slugify(placeholder, id);

  const space: Space = {
    id,
    description: placeholder,
    body: input.body,
    raw_text: input.body,
    client: null,
    due_at: null,
    due_at_utc: null,
    recurrence: null,
    completed_at: null,
    folder,
    session_id: null,
    source_skill_id: sourceSkillId ?? null,
    attachments: [],
    status: 'captured',
    created_at: now,
    updated_at: now,
  };

  // Log first — the event log is authoritative
  appendEvent(logPath, 'space.create', {
    id: space.id,
    description: space.description,
    body: space.body,
    raw_text: space.raw_text,
    client: space.client,
    due_at: space.due_at,
    due_at_utc: space.due_at_utc,
    recurrence: space.recurrence,
    completed_at: space.completed_at,
    folder: space.folder,
    source_skill_id: space.source_skill_id,
    attachments: JSON.stringify(space.attachments),
    status: space.status,
    created_at: space.created_at,
    updated_at: space.updated_at,
  });

  db.prepare(
    `INSERT INTO spaces (id, description, body, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, session_id, source_skill_id, attachments, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(space.id, space.description, space.body, space.raw_text, space.client, space.due_at, space.due_at_utc, space.recurrence, space.completed_at, space.folder, space.session_id, space.source_skill_id, JSON.stringify(space.attachments), space.status, space.created_at, space.updated_at);

  return space;
}

export function getSpace(id: string): Space | null {
  const row = db.prepare(
    `SELECT id, description, body, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, session_id, source_skill_id, attachments, status, created_at, updated_at
     FROM spaces WHERE id = ?`
  ).get(id) as any | undefined;
  if (!row) return null;
  return { ...row, attachments: parseAttachments(row.attachments) };
}

export function listSpaces(): Space[] {
  const rows = db.prepare(
    `SELECT id, description, body, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, session_id, source_skill_id, attachments, status, created_at, updated_at
     FROM spaces
     ORDER BY
       CASE WHEN status = 'done' THEN 1 ELSE 0 END ASC,
       CASE WHEN status = 'in_progress' THEN 0 ELSE 1 END ASC,
       CASE WHEN due_at_utc IS NOT NULL THEN 0 ELSE 1 END ASC,
       due_at_utc ASC,
       updated_at DESC`
  ).all() as any[];
  return rows.map(r => ({ ...r, attachments: parseAttachments(r.attachments) }));
}

export function updateSpace(id: string, updates: Partial<Pick<Space, 'description' | 'body' | 'client' | 'due_at' | 'due_at_utc' | 'recurrence' | 'completed_at' | 'status' | 'attachments'>>): Space | null {
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
  appendEvent(logPath, 'space.update', { id, fields });

  const sets = Object.keys(fields).map(k => `${k} = ?`);
  const values = [...Object.values(fields), id];
  db.prepare(`UPDATE spaces SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  return getSpace(id);
}

/** Compare-and-swap update: only applies if updated_at matches expectedVersion. */
export function updateSpaceCAS(id: string, expectedVersion: string, updates: Partial<Pick<Space, 'description' | 'body' | 'client' | 'due_at' | 'due_at_utc' | 'recurrence' | 'completed_at' | 'status' | 'attachments'>>): Space | null {
  const current = getSpace(id);
  if (!current || current.updated_at !== expectedVersion) return null;
  return updateSpace(id, updates);
}

/** Assign a workspace folder to an space. Logged as a dedicated event. */
export function assignSpaceFolder(spaceId: string, folder: string): void {
  appendEvent(logPath, 'space.assign_folder', { id: spaceId, folder });
  const now = new Date().toISOString();
  db.prepare('UPDATE spaces SET folder = ?, updated_at = ? WHERE id = ?')
    .run(folder, now, spaceId);
}

export function logSpaceEvent(spaceId: string, eventType: string, data: { due_at?: string | null; due_at_utc?: string | null; completed_at?: string | null; recurrence_json?: string | null } = {}): void {
  const now = new Date().toISOString();
  const eventId = uuidv4();

  appendEvent(logPath, 'intent_event.log', {
    id: eventId,
    space_id: spaceId,
    event_type: eventType,
    due_at: data.due_at ?? null,
    due_at_utc: data.due_at_utc ?? null,
    completed_at: data.completed_at ?? null,
    recurrence_json: data.recurrence_json ?? null,
    created_at: now,
  });

  db.prepare(
    `INSERT INTO space_events (id, space_id, event_type, due_at, due_at_utc, completed_at, recurrence_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(eventId, spaceId, eventType, data.due_at ?? null, data.due_at_utc ?? null, data.completed_at ?? null, data.recurrence_json ?? null, now);
}

export interface SpaceEvent {
  id: string;
  space_id: string;
  event_type: string;
  due_at: string | null;
  due_at_utc: string | null;
  completed_at: string | null;
  recurrence_json: string | null;
  created_at: string;
  space_description: string | null;
  space_client: string | null;
  session_id: string | null;
}

export function listSpaceEvents(limit = 100): SpaceEvent[] {
  return db.prepare(
    `SELECT e.id, e.space_id, e.event_type, e.due_at, e.due_at_utc, e.completed_at, e.recurrence_json, e.created_at,
            i.description AS space_description, i.client AS space_client, i.session_id
     FROM space_events e
     LEFT JOIN spaces i ON e.space_id = i.id
     ORDER BY e.created_at DESC
     LIMIT ?`
  ).all(limit) as SpaceEvent[];
}

/** Set session_id on an space — local only, not logged (per-machine). */
export function setSpaceSessionId(spaceId: string, sessionId: string): void {
  db.prepare('UPDATE spaces SET session_id = ? WHERE id = ?')
    .run(sessionId, spaceId);
}

export function deleteSpace(id: string): boolean {
  appendEvent(logPath, 'space.delete', { id });
  const result = db.prepare('DELETE FROM spaces WHERE id = ?').run(id);
  return result.changes > 0;
}

/** Read all canvas files from disk and populate the canvas_content column. */
export function syncCanvasContent(workspaceRoot: string): void {
  const rows = db.prepare('SELECT id, folder FROM spaces WHERE folder IS NOT NULL').all() as { id: string; folder: string }[];
  const stmt = db.prepare('UPDATE spaces SET canvas_content = ? WHERE id = ?');
  for (const row of rows) {
    try {
      const content = readCanvas(workspaceRoot, row.folder);
      stmt.run(content, row.id);
    } catch { /* folder may not exist yet */ }
  }
}

/** Update the cached canvas content for a single space. */
export function updateCanvasContent(spaceId: string, content: string): void {
  db.prepare('UPDATE spaces SET canvas_content = ? WHERE id = ?').run(content, spaceId);
}

/** Search spaces by description, body, or canvas content. */
export function searchSpaces(query: string): Space[] {
  const like = `%${query}%`;
  const rows = db.prepare(
    `SELECT id, description, body, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, session_id, source_skill_id, attachments, status, created_at, updated_at
     FROM spaces
     WHERE description LIKE ? OR body LIKE ? OR canvas_content LIKE ?
     ORDER BY updated_at DESC`
  ).all(like, like, like) as any[];
  return rows.map(r => ({ ...r, attachments: parseAttachments(r.attachments) }));
}

// ── Canvas Agents ─────────────────────────────────────────

export function createCanvasAgent(agent: CanvasAgent): void {
  appendEvent(logPath, 'canvas_agent.created', {
    id: agent.id,
    space_id: agent.space_id,
    selected_text: agent.selected_text,
    session_id: agent.session_id,
    pid: agent.pid,
    status: agent.status,
    created_at: agent.created_at,
    updated_at: agent.updated_at,
  });

  db.prepare(
    `INSERT INTO canvas_agents (id, space_id, selected_text, session_id, pid, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(agent.id, agent.space_id, agent.selected_text, agent.session_id, agent.pid, agent.status, agent.created_at, agent.updated_at);
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

export function listCanvasAgents(spaceId: string): CanvasAgent[] {
  return db.prepare(
    `SELECT id, space_id, selected_text, session_id, pid, status, created_at, updated_at
     FROM canvas_agents WHERE space_id = ? ORDER BY created_at DESC`
  ).all(spaceId) as CanvasAgent[];
}

export function listAllRunningAgents(): CanvasAgent[] {
  return db.prepare(
    `SELECT id, space_id, selected_text, session_id, pid, status, created_at, updated_at
     FROM canvas_agents WHERE status = 'running'`
  ).all() as CanvasAgent[];
}

// ── Agent Sessions (central registry) ─────────────────────

export function createAgentSession(session: AgentSession): void {
  appendEvent(logPath, 'agent_session.created', {
    id: session.id,
    session_id: session.session_id,
    space_id: session.space_id,
    prompt: session.prompt,
    status: session.status,
    summary: session.summary,
    working_dir: session.working_dir,
    source: session.source,
    persona_handle: session.persona_handle,
    quoted_text: session.quoted_text,
    run_location: session.run_location,
    created_at: session.created_at,
    updated_at: session.updated_at,
  });

  db.prepare(
    `INSERT INTO agent_sessions (id, session_id, space_id, prompt, status, summary, working_dir, source, persona_handle, quoted_text, run_location, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    session.id, session.session_id, session.space_id, session.prompt,
    session.status, session.summary, session.working_dir, session.source,
    session.persona_handle, session.quoted_text, session.run_location ?? 'local',
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
    `SELECT id, session_id, space_id, prompt, status, summary, working_dir, source, persona_handle, quoted_text, run_location, created_at, updated_at
     FROM agent_sessions WHERE id = ?`
  ).get(id) as AgentSession | undefined ?? null;
}

export function listAgentSessions(): AgentSession[] {
  return db.prepare(
    `SELECT id, session_id, space_id, prompt, status, summary, working_dir, source, persona_handle, quoted_text, run_location, created_at, updated_at
     FROM agent_sessions ORDER BY created_at DESC`
  ).all() as AgentSession[];
}

/** Update the session_id for an agent across both tables (e.g. after session recreation). */
export function updateAgentSessionId(id: string, newSessionId: string): void {
  const now = new Date().toISOString();
  appendEvent(logPath, 'agent_session.updated', { id, session_id: newSessionId, updated_at: now });
  db.prepare('UPDATE agent_sessions SET session_id = ?, updated_at = ? WHERE id = ?')
    .run(newSessionId, now, id);
  // Also update canvas_agents if present (best-effort)
  try {
    db.prepare('UPDATE canvas_agents SET session_id = ?, updated_at = ? WHERE id = ?')
      .run(newSessionId, now, id);
  } catch { /* non-fatal — row may not exist for quick agents */ }
}

export function deleteAgentSession(id: string): void {
  appendEvent(logPath, 'agent_session.deleted', { id });
  db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id);
  // Cascade chat events when the session goes away.
  db.prepare('DELETE FROM agent_chat_events WHERE agent_id = ?').run(id);
}

// ── Agent Chat Events ────────────────────────────────────
// Captured from the SDK session's catch-all event stream so we can
// reconstruct a transcript independent of the SDK runtime.  Used by
// `replayChatIntoFreshSession` when the original session can't be
// resumed.

/**
 * Append a chat event for an agent.  Returns the newly-assigned `seq`.
 *
 * Idempotent on `(agent_id, event_id)`: if `event_id` is provided and a
 * row with the same agent + event_id already exists, the existing row's
 * seq is returned without inserting a duplicate.  This protects against
 * double-capture when the SDK replays events on resume.
 */
export function appendAgentChatEvent(
  agentId: string,
  event: { event_id: string | null; type: string; timestamp: string; payload: string },
): number {
  // Idempotency: same SDK event id ⇒ no-op insert, return existing seq.
  if (event.event_id) {
    const existing = db.prepare(
      'SELECT seq FROM agent_chat_events WHERE agent_id = ? AND event_id = ?'
    ).get(agentId, event.event_id) as { seq: number } | undefined;
    if (existing) return existing.seq;
  }

  const row = db.prepare(
    'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM agent_chat_events WHERE agent_id = ?'
  ).get(agentId) as { max_seq: number };
  const seq = row.max_seq + 1;

  appendEvent(logPath, 'agent_chat.appended', {
    agent_id: agentId,
    seq,
    event_id: event.event_id,
    type: event.type,
    timestamp: event.timestamp,
    payload: event.payload,
  });

  db.prepare(
    `INSERT INTO agent_chat_events (agent_id, seq, event_id, type, timestamp, payload)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(agentId, seq, event.event_id, event.type, event.timestamp, event.payload);

  return seq;
}

/** Return all persisted chat events for an agent, ordered oldest-first. */
export function listAgentChatEvents(agentId: string): AgentChatEvent[] {
  return db.prepare(
    `SELECT seq, event_id, type, timestamp, payload
     FROM agent_chat_events WHERE agent_id = ? ORDER BY seq ASC`
  ).all(agentId) as AgentChatEvent[];
}

/** Remove all persisted chat events for an agent. */
export function clearAgentChatEvents(agentId: string): void {
  db.prepare('DELETE FROM agent_chat_events WHERE agent_id = ?').run(agentId);
}

// ── Skills ────────────────────────────────────────────────

export function upsertSkill(skill: Skill): void {
  db.prepare(
    `INSERT INTO skills (id, name, description, emoji, folder_path, file_path, schedule, schedule_time, schedule_day, next_run_at, last_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       emoji = excluded.emoji,
       folder_path = excluded.folder_path,
       file_path = excluded.file_path,
       schedule = COALESCE(excluded.schedule, skills.schedule),
       schedule_time = COALESCE(excluded.schedule_time, skills.schedule_time),
       schedule_day = COALESCE(excluded.schedule_day, skills.schedule_day),
       next_run_at = COALESCE(excluded.next_run_at, skills.next_run_at),
       last_run_at = COALESCE(excluded.last_run_at, skills.last_run_at),
       updated_at = excluded.updated_at`
  ).run(skill.id, skill.name, skill.description, skill.emoji, skill.folder, skill.filePath,
        skill.schedule, skill.schedule_time, skill.schedule_day, skill.next_run_at, skill.last_run_at,
        skill.created_at, skill.updated_at);
}

export function removeSkill(id: string): void {
  db.prepare('DELETE FROM skills WHERE id = ?').run(id);
}

export function listSkills(): Skill[] {
  return (db.prepare(
    `SELECT id, name, description, emoji, folder_path, file_path, schedule, schedule_time, schedule_day, next_run_at, last_run_at, created_at, updated_at
     FROM skills ORDER BY name ASC`
  ).all() as Array<{ id: string; name: string; description: string; emoji: string; folder_path: string; file_path: string; schedule: string | null; schedule_time: string | null; schedule_day: number | null; next_run_at: string | null; last_run_at: string | null; created_at: string; updated_at: string }>)
    .map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      emoji: row.emoji,
      folder: row.folder_path,
      filePath: row.file_path,
      schedule: row.schedule as Skill['schedule'],
      schedule_time: row.schedule_time,
      schedule_day: row.schedule_day,
      next_run_at: row.next_run_at,
      last_run_at: row.last_run_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
}

export function getSkill(id: string): Skill | null {
  const row = db.prepare(
    `SELECT id, name, description, emoji, folder_path, file_path, schedule, schedule_time, schedule_day, next_run_at, last_run_at, created_at, updated_at
     FROM skills WHERE id = ?`
  ).get(id) as { id: string; name: string; description: string; emoji: string; folder_path: string; file_path: string; schedule: string | null; schedule_time: string | null; schedule_day: number | null; next_run_at: string | null; last_run_at: string | null; created_at: string; updated_at: string } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    emoji: row.emoji,
    folder: row.folder_path,
    filePath: row.file_path,
    schedule: row.schedule as Skill['schedule'],
    schedule_time: row.schedule_time,
    schedule_day: row.schedule_day,
    next_run_at: row.next_run_at,
    last_run_at: row.last_run_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Return skills whose next_run_at is at or before the given UTC timestamp. */
export function getDueSkills(nowUtc: string): Skill[] {
  return (db.prepare(
    `SELECT id, name, description, emoji, folder_path, file_path, schedule, schedule_time, schedule_day, next_run_at, last_run_at, created_at, updated_at
     FROM skills
     WHERE schedule IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= ?
     ORDER BY next_run_at ASC`
  ).all(nowUtc) as Array<{ id: string; name: string; description: string; emoji: string; folder_path: string; file_path: string; schedule: string | null; schedule_time: string | null; schedule_day: number | null; next_run_at: string | null; last_run_at: string | null; created_at: string; updated_at: string }>)
    .map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      emoji: row.emoji,
      folder: row.folder_path,
      filePath: row.file_path,
      schedule: row.schedule as Skill['schedule'],
      schedule_time: row.schedule_time,
      schedule_day: row.schedule_day,
      next_run_at: row.next_run_at,
      last_run_at: row.last_run_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
}

/** Update schedule fields for a skill. */
export function updateSkillSchedule(
  id: string,
  schedule: string | null,
  scheduleTime: string | null,
  scheduleDay: number | null,
  nextRunAt: string | null
): void {
  db.prepare(
    `UPDATE skills SET schedule = ?, schedule_time = ?, schedule_day = ?, next_run_at = ? WHERE id = ?`
  ).run(schedule, scheduleTime, scheduleDay, nextRunAt, id);
}

/** Mark a skill as having just run. */
export function markSkillRun(id: string, lastRunAt: string, nextRunAt: string | null): void {
  db.prepare(
    `UPDATE skills SET last_run_at = ?, next_run_at = ? WHERE id = ?`
  ).run(lastRunAt, nextRunAt, id);
}

/**
 * Atomically claim a scheduled run via CAS on next_run_at.
 * Returns true if this caller won the claim (was able to advance the row),
 * false if another caller/tick already advanced it. This prevents duplicate
 * launches from overlapping scheduler ticks.
 */
export function claimSkillRun(
  id: string,
  expectedNextRunAt: string,
  newLastRunAt: string,
  newNextRunAt: string | null
): boolean {
  const result = db.prepare(
    `UPDATE skills SET last_run_at = ?, next_run_at = ? WHERE id = ? AND next_run_at = ?`
  ).run(newLastRunAt, newNextRunAt, id, expectedNextRunAt);
  return result.changes > 0;
}

/**
 * Return scheduled skills missing a next_run_at — e.g. just rebuilt from disk
 * after restart. Used by the scheduler to recover schedules on startup.
 */
export function getScheduledSkillsNeedingNextRun(): Skill[] {
  return (db.prepare(
    `SELECT id, name, description, emoji, folder_path, file_path, schedule, schedule_time, schedule_day, next_run_at, last_run_at, created_at, updated_at
     FROM skills
     WHERE schedule IS NOT NULL AND next_run_at IS NULL`
  ).all() as Array<{ id: string; name: string; description: string; emoji: string; folder_path: string; file_path: string; schedule: string | null; schedule_time: string | null; schedule_day: number | null; next_run_at: string | null; last_run_at: string | null; created_at: string; updated_at: string }>)
    .map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      emoji: row.emoji,
      folder: row.folder_path,
      filePath: row.file_path,
      schedule: row.schedule as Skill['schedule'],
      schedule_time: row.schedule_time,
      schedule_day: row.schedule_day,
      next_run_at: row.next_run_at,
      last_run_at: row.last_run_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
}

// ── Subagent Records ────────────────────────────────────────

export interface SubagentRecordRow {
  id: string;
  parent_agent_id: string;
  tool_call_id: string | null;
  agent_name: string;
  display_name: string | null;
  description: string | null;
  agent_type: string | null;
  status: string;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  model: string | null;
  total_tokens: number | null;
  total_tool_calls: number | null;
  error: string | null;
  streaming_content: string;
  turns_json: string;
  progress_json: string;
  created_at: string;
  updated_at: string;
}

export interface SubagentToolCallRow {
  id: number;
  subagent_id: string;
  parent_agent_id: string;
  tool_call_id: string | null;
  tool_name: string;
  arguments_json: string | null;
  result: string | null;
  success: number;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: string;
}

export function createSubagentRecord(record: Omit<SubagentRecordRow, 'created_at' | 'updated_at'>): void {
  const now = new Date().toISOString();
  appendEvent(logPath, 'subagent.created', { ...record, created_at: now, updated_at: now });
  db.prepare(
    `INSERT OR REPLACE INTO subagent_records (id, parent_agent_id, tool_call_id, agent_name, display_name, description, agent_type, status, started_at, completed_at, duration_ms, model, total_tokens, total_tool_calls, error, streaming_content, turns_json, progress_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id, record.parent_agent_id, record.tool_call_id, record.agent_name,
    record.display_name, record.description, record.agent_type, record.status,
    record.started_at, record.completed_at ?? null, record.duration_ms ?? null,
    record.model ?? null, record.total_tokens ?? null, record.total_tool_calls ?? null,
    record.error ?? null, record.streaming_content ?? '', record.turns_json ?? '[]',
    record.progress_json ?? '{}', now, now,
  );
}

export function updateSubagentRecord(id: string, updates: Partial<Pick<SubagentRecordRow, 'status' | 'completed_at' | 'duration_ms' | 'model' | 'total_tokens' | 'total_tool_calls' | 'error' | 'streaming_content' | 'turns_json' | 'progress_json'>>): void {
  const now = new Date().toISOString();
  appendEvent(logPath, 'subagent.updated', { id, ...updates, updated_at: now });

  const sets: string[] = ['updated_at = ?'];
  const values: any[] = [now];
  for (const [key, val] of Object.entries(updates)) {
    sets.push(`${key} = ?`);
    values.push(val ?? null);
  }
  values.push(id);
  db.prepare(`UPDATE subagent_records SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function listSubagentRecords(parentAgentId: string): SubagentRecordRow[] {
  return db.prepare(
    `SELECT * FROM subagent_records WHERE parent_agent_id = ? ORDER BY started_at ASC`
  ).all(parentAgentId) as SubagentRecordRow[];
}

export function createSubagentToolCall(tc: Omit<SubagentToolCallRow, 'id' | 'created_at'>): void {
  const now = new Date().toISOString();
  appendEvent(logPath, 'subagent_tool.created', { ...tc, created_at: now });
  db.prepare(
    `INSERT INTO subagent_tool_calls (subagent_id, parent_agent_id, tool_call_id, tool_name, arguments_json, result, success, error, started_at, completed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tc.subagent_id, tc.parent_agent_id, tc.tool_call_id, tc.tool_name,
    tc.arguments_json, tc.result ?? null, tc.success, tc.error ?? null,
    tc.started_at ?? null, tc.completed_at ?? null, now,
  );
}

export function updateSubagentToolCall(subagentId: string, toolCallId: string, updates: { success: number; result?: string; error?: string; completed_at?: number }): void {
  const sets: string[] = [];
  const values: any[] = [];
  for (const [key, val] of Object.entries(updates)) {
    sets.push(`${key} = ?`);
    values.push(val ?? null);
  }
  if (sets.length === 0) return;
  appendEvent(logPath, 'subagent_tool.updated', { subagent_id: subagentId, tool_call_id: toolCallId, ...updates });
  values.push(subagentId, toolCallId);
  db.prepare(`UPDATE subagent_tool_calls SET ${sets.join(', ')} WHERE subagent_id = ? AND tool_call_id = ?`).run(...values);
}

export function listSubagentToolCalls(subagentId: string): SubagentToolCallRow[] {
  return db.prepare(
    `SELECT * FROM subagent_tool_calls WHERE subagent_id = ? ORDER BY id ASC`
  ).all(subagentId) as SubagentToolCallRow[];
}
