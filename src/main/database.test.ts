import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock electron (required by config.ts dependency chain)
vi.mock('electron', () => ({
  app: { getPath: () => '/mock/electron-path' },
}));

// Mock eventlog — spy on appendEvent, no-op replayLog
vi.mock('./eventlog', () => ({
  appendEvent: vi.fn(),
  replayLog: vi.fn(),
}));

// Mock workspace — readCanvas returns configurable content
vi.mock('./workspace', () => ({
  readCanvas: vi.fn(() => ''),
}));

import {
  initDatabase,
  getDatabase,
  isInitialized,
  createIntent,
  getIntent,
  listIntents,
  updateIntent,
  updateIntentCAS,
  deleteIntent,
  assignIntentFolder,
  searchIntents,
  syncCanvasContent,
  updateCanvasContent,
  mergeSessionIds,
  logIntentEvent,
  listIntentEvents,
  setIntentSessionId,
  createCanvasAgent,
  updateCanvasAgentStatus,
  listCanvasAgents,
  listAllRunningAgents,
  createAgentSession,
  updateAgentSessionStatus,
  getAgentSession,
  listAgentSessions,
} from './database';
import { appendEvent } from './eventlog';
import { readCanvas } from './workspace';
import type { CanvasAgent, AgentSession, Attachment } from '../shared/types';

let testDir: string;

function freshDb() {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-db-test-'));
  const dbPath = path.join(testDir, 'test.db');
  const logPath = path.join(testDir, 'events.jsonl');
  initDatabase(dbPath, logPath);
}

beforeEach(() => {
  vi.clearAllMocks();
  freshDb();
});

afterEach(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// ── Helpers ───────────────────────────────────────────────

function makeIntent(body = 'Test intent body') {
  return createIntent({ body });
}

function makeCanvasAgent(intentId: string, overrides: Partial<CanvasAgent> = {}): CanvasAgent {
  const now = new Date().toISOString();
  return {
    id: `agent-${Date.now()}`,
    intent_id: intentId,
    selected_text: 'some text',
    session_id: 'sess-1',
    pid: null,
    status: 'running',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeAgentSession(overrides: Partial<AgentSession> = {}): AgentSession {
  const now = new Date().toISOString();
  return {
    id: `as-${Date.now()}`,
    session_id: 'sess-1',
    intent_id: null,
    prompt: 'Do something',
    status: 'running',
    summary: '',
    working_dir: null,
    source: 'sdk',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('database', () => {
  describe('initDatabase', () => {
    it('initializes the database and calls replayLog', () => {
      expect(isInitialized()).toBe(true);
      expect(getDatabase()).toBeDefined();
    });
  });

  // ── Intent CRUD lifecycle ──────────────────────────────

  describe('Intent CRUD lifecycle', () => {
    it('creates, gets, lists, updates, and deletes an intent', () => {
      const intent = makeIntent('Buy groceries');
      expect(intent.id).toBeDefined();
      expect(intent.description).toBe('Buy groceries');
      expect(intent.body).toBe('Buy groceries');
      expect(intent.status).toBe('captured');
      expect(appendEvent).toHaveBeenCalledWith(
        expect.any(String),
        'intent.create',
        expect.objectContaining({ id: intent.id }),
      );

      // getIntent
      const fetched = getIntent(intent.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(intent.id);

      // listIntents
      const list = listIntents();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(intent.id);

      // updateIntent
      const updated = updateIntent(intent.id, { description: 'Updated title', status: 'in_progress' });
      expect(updated).not.toBeNull();
      expect(updated!.description).toBe('Updated title');
      expect(updated!.status).toBe('in_progress');
      expect(appendEvent).toHaveBeenCalledWith(
        expect.any(String),
        'intent.update',
        expect.objectContaining({ id: intent.id }),
      );

      // deleteIntent
      const deleted = deleteIntent(intent.id);
      expect(deleted).toBe(true);
      expect(getIntent(intent.id)).toBeNull();
      expect(appendEvent).toHaveBeenCalledWith(
        expect.any(String),
        'intent.delete',
        expect.objectContaining({ id: intent.id }),
      );
    });

    it('deleteIntent returns false for non-existent id', () => {
      expect(deleteIntent('nonexistent-id')).toBe(false);
    });

    it('getIntent returns null for unknown id', () => {
      expect(getIntent('nonexistent-id')).toBeNull();
    });
  });

  // ── Placeholder title ──────────────────────────────────

  describe('placeholder title', () => {
    it('extracts the first line as the description', () => {
      const intent = createIntent({ body: 'First line\nSecond line\nThird line' });
      expect(intent.description).toBe('First line');
    });

    it('truncates long first lines to 80 chars with ellipsis', () => {
      const longLine = 'A'.repeat(100);
      const intent = createIntent({ body: longLine });
      expect(intent.description).toBe('A'.repeat(77) + '…');
      expect(intent.description.length).toBe(78);
    });

    it('preserves short first lines without truncation', () => {
      const intent = createIntent({ body: 'Short title' });
      expect(intent.description).toBe('Short title');
    });

    it('uses exactly 80-char first line without truncation', () => {
      const line80 = 'B'.repeat(80);
      const intent = createIntent({ body: line80 });
      expect(intent.description).toBe(line80);
    });
  });

  // ── Attachments round-trip ─────────────────────────────

  describe('attachments round-trip', () => {
    it('serializes and deserializes attachments', () => {
      const intent = makeIntent();
      const attachments: Attachment[] = [
        { type: 'url', name: 'Link', url: 'https://example.com' },
        { type: 'file', name: 'Doc', url: 'file://doc.pdf', relativePath: 'attachments/doc.pdf' },
      ];
      const updated = updateIntent(intent.id, { attachments });
      expect(updated!.attachments).toEqual(attachments);

      // Re-fetch to confirm persistence
      const fetched = getIntent(intent.id);
      expect(fetched!.attachments).toEqual(attachments);
    });

    it('returns empty array for null/empty attachments', () => {
      const intent = makeIntent();
      expect(intent.attachments).toEqual([]);

      // Manually set to null via raw DB
      getDatabase().prepare('UPDATE intents SET attachments = NULL WHERE id = ?').run(intent.id);
      const fetched = getIntent(intent.id);
      expect(fetched!.attachments).toEqual([]);

      // Manually set to invalid JSON
      getDatabase().prepare("UPDATE intents SET attachments = 'not-json' WHERE id = ?").run(intent.id);
      const fetched2 = getIntent(intent.id);
      expect(fetched2!.attachments).toEqual([]);
    });
  });

  // ── updateIntentCAS ────────────────────────────────────

  describe('updateIntentCAS', () => {
    it('succeeds with matching version', () => {
      const intent = makeIntent();
      const result = updateIntentCAS(intent.id, intent.updated_at, { description: 'CAS updated' });
      expect(result).not.toBeNull();
      expect(result!.description).toBe('CAS updated');
    });

    it('returns null with stale version', () => {
      const intent = makeIntent();
      const result = updateIntentCAS(intent.id, 'stale-version-string', { description: 'Should fail' });
      expect(result).toBeNull();
      // Verify original is untouched
      const fetched = getIntent(intent.id);
      expect(fetched!.description).toBe(intent.description);
    });

    it('returns null for non-existent intent', () => {
      const result = updateIntentCAS('nonexistent', '2024-01-01T00:00:00.000Z', { description: 'nope' });
      expect(result).toBeNull();
    });
  });

  // ── listIntents ordering ───────────────────────────────

  describe('listIntents ordering', () => {
    it('orders: done last, in_progress first, due dates ascending, then updated_at descending', () => {
      // Create intents with controlled timestamps
      const a = createIntent({ body: 'A - in_progress' });
      const b = createIntent({ body: 'B - captured with due' });
      const c = createIntent({ body: 'C - captured no due' });
      const d = createIntent({ body: 'D - done' });

      // Set statuses and due dates via raw DB for precise control
      const db = getDatabase();
      db.prepare("UPDATE intents SET status = 'in_progress', updated_at = '2024-06-01T00:00:00Z' WHERE id = ?").run(a.id);
      db.prepare("UPDATE intents SET status = 'captured', due_at_utc = '2024-07-01T00:00:00Z', updated_at = '2024-05-01T00:00:00Z' WHERE id = ?").run(b.id);
      db.prepare("UPDATE intents SET status = 'captured', updated_at = '2024-05-02T00:00:00Z' WHERE id = ?").run(c.id);
      db.prepare("UPDATE intents SET status = 'done', updated_at = '2024-06-15T00:00:00Z' WHERE id = ?").run(d.id);

      const list = listIntents();
      const ids = list.map(i => i.id);

      // in_progress first, then captured with due, then captured without due, then done
      expect(ids[0]).toBe(a.id); // in_progress
      expect(ids[1]).toBe(b.id); // captured with due_at_utc
      expect(ids[2]).toBe(c.id); // captured, no due, but more recent
      expect(ids[3]).toBe(d.id); // done last
    });
  });

  // ── searchIntents ──────────────────────────────────────

  describe('searchIntents', () => {
    it('matches in description', () => {
      const intent = makeIntent('search-term-unique');
      const results = searchIntents('search-term-unique');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(intent.id);
    });

    it('matches in body', () => {
      const intent = createIntent({ body: 'Title\nBody has findme123 keyword' });
      const results = searchIntents('findme123');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(intent.id);
    });

    it('matches in canvas_content', () => {
      const intent = makeIntent();
      updateCanvasContent(intent.id, 'canvas-unique-content-xyz');
      const results = searchIntents('canvas-unique-content-xyz');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(intent.id);
    });

    it('returns no results for non-matching query', () => {
      makeIntent('Totally unrelated');
      const results = searchIntents('zzz-nonexistent-zzz');
      expect(results).toHaveLength(0);
    });
  });

  // ── assignIntentFolder ─────────────────────────────────

  describe('assignIntentFolder', () => {
    it('sets folder and logs event', () => {
      const intent = makeIntent();
      assignIntentFolder(intent.id, 'my-folder-abc1');

      const fetched = getIntent(intent.id);
      expect(fetched!.folder).toBe('my-folder-abc1');
      expect(appendEvent).toHaveBeenCalledWith(
        expect.any(String),
        'intent.assign_folder',
        expect.objectContaining({ id: intent.id, folder: 'my-folder-abc1' }),
      );
    });
  });

  // ── syncCanvasContent ──────────────────────────────────

  describe('syncCanvasContent', () => {
    it('populates canvas_content from disk for intents with folders', () => {
      const intent = makeIntent();
      assignIntentFolder(intent.id, 'test-folder');

      vi.mocked(readCanvas).mockReturnValue('# Canvas Content\nHello world');
      syncCanvasContent('/fake/workspace');

      // canvas_content isn't in the Intent type — verify via raw DB
      const row = getDatabase().prepare('SELECT canvas_content FROM intents WHERE id = ?').get(intent.id) as any;
      expect(row.canvas_content).toBe('# Canvas Content\nHello world');
      expect(readCanvas).toHaveBeenCalledWith('/fake/workspace', 'test-folder');
    });

    it('skips intents without folders', () => {
      makeIntent(); // no folder
      syncCanvasContent('/fake/workspace');
      expect(readCanvas).not.toHaveBeenCalled();
    });

    it('handles readCanvas errors gracefully', () => {
      const intent = makeIntent();
      assignIntentFolder(intent.id, 'bad-folder');
      vi.mocked(readCanvas).mockImplementation(() => { throw new Error('ENOENT'); });

      // Should not throw
      expect(() => syncCanvasContent('/fake/workspace')).not.toThrow();
    });
  });

  // ── updateCanvasContent ────────────────────────────────

  describe('updateCanvasContent', () => {
    it('updates the cached canvas content for an intent', () => {
      const intent = makeIntent();
      updateCanvasContent(intent.id, 'New canvas content');

      const db = getDatabase();
      const row = db.prepare('SELECT canvas_content FROM intents WHERE id = ?').get(intent.id) as any;
      expect(row.canvas_content).toBe('New canvas content');
    });
  });

  // ── Canvas Agents ──────────────────────────────────────

  describe('Canvas Agents', () => {
    it('creates and lists canvas agents for an intent', () => {
      const intent = makeIntent();
      const agent = makeCanvasAgent(intent.id, { id: 'ca-1', session_id: 'sess-100' });
      createCanvasAgent(agent);

      expect(appendEvent).toHaveBeenCalledWith(
        expect.any(String),
        'canvas_agent.created',
        expect.objectContaining({ id: 'ca-1' }),
      );

      const agents = listCanvasAgents(intent.id);
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('ca-1');
      expect(agents[0].session_id).toBe('sess-100');
    });

    it('updateCanvasAgentStatus updates status', () => {
      const intent = makeIntent();
      const agent = makeCanvasAgent(intent.id, { id: 'ca-2' });
      createCanvasAgent(agent);

      updateCanvasAgentStatus('ca-2', 'completed');

      const agents = listCanvasAgents(intent.id);
      expect(agents[0].status).toBe('completed');
      expect(appendEvent).toHaveBeenCalledWith(
        expect.any(String),
        'canvas_agent.updated',
        expect.objectContaining({ id: 'ca-2', status: 'completed' }),
      );
    });

    it('updateCanvasAgentStatus updates pid when provided', () => {
      const intent = makeIntent();
      const agent = makeCanvasAgent(intent.id, { id: 'ca-3' });
      createCanvasAgent(agent);

      updateCanvasAgentStatus('ca-3', 'running', 12345);

      const agents = listCanvasAgents(intent.id);
      expect(agents[0].pid).toBe(12345);
    });

    it('listAllRunningAgents returns only running agents', () => {
      const intent = makeIntent();
      const running = makeCanvasAgent(intent.id, { id: 'ca-running', status: 'running' });
      const completed = makeCanvasAgent(intent.id, { id: 'ca-done', status: 'completed' });
      createCanvasAgent(running);
      createCanvasAgent(completed);

      const result = listAllRunningAgents();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ca-running');
    });
  });

  // ── Agent Sessions ─────────────────────────────────────

  describe('Agent Sessions', () => {
    it('creates, gets, and lists agent sessions', () => {
      const session = makeAgentSession({ id: 'as-1', session_id: 'sid-1', prompt: 'Fix bugs' });
      createAgentSession(session);

      expect(appendEvent).toHaveBeenCalledWith(
        expect.any(String),
        'agent_session.created',
        expect.objectContaining({ id: 'as-1' }),
      );

      const fetched = getAgentSession('as-1');
      expect(fetched).not.toBeNull();
      expect(fetched!.prompt).toBe('Fix bugs');
      expect(fetched!.status).toBe('running');

      const list = listAgentSessions();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('as-1');
    });

    it('getAgentSession returns null for unknown id', () => {
      expect(getAgentSession('nonexistent')).toBeNull();
    });

    it('updateAgentSessionStatus updates status without summary', () => {
      const session = makeAgentSession({ id: 'as-2' });
      createAgentSession(session);

      updateAgentSessionStatus('as-2', 'completed');

      const fetched = getAgentSession('as-2');
      expect(fetched!.status).toBe('completed');
      expect(fetched!.summary).toBe(''); // unchanged
    });

    it('updateAgentSessionStatus updates status with summary', () => {
      const session = makeAgentSession({ id: 'as-3' });
      createAgentSession(session);

      updateAgentSessionStatus('as-3', 'completed', 'All bugs fixed');

      const fetched = getAgentSession('as-3');
      expect(fetched!.status).toBe('completed');
      expect(fetched!.summary).toBe('All bugs fixed');
      expect(appendEvent).toHaveBeenCalledWith(
        expect.any(String),
        'agent_session.updated',
        expect.objectContaining({ id: 'as-3', status: 'completed', summary: 'All bugs fixed' }),
      );
    });

    it('listAgentSessions returns sessions in descending created_at order', () => {
      const s1 = makeAgentSession({ id: 'as-old', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' });
      const s2 = makeAgentSession({ id: 'as-new', created_at: '2024-06-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z' });
      createAgentSession(s1);
      createAgentSession(s2);

      const list = listAgentSessions();
      expect(list[0].id).toBe('as-new');
      expect(list[1].id).toBe('as-old');
    });
  });

  // ── mergeSessionIds ────────────────────────────────────

  describe('mergeSessionIds', () => {
    it('injects session IDs into existing intents', () => {
      const intent1 = makeIntent('Intent 1');
      const intent2 = makeIntent('Intent 2');

      mergeSessionIds({
        [intent1.id]: 'local-session-1',
        [intent2.id]: 'local-session-2',
      });

      expect(getIntent(intent1.id)!.session_id).toBe('local-session-1');
      expect(getIntent(intent2.id)!.session_id).toBe('local-session-2');
    });

    it('ignores non-existent intent IDs without error', () => {
      expect(() => mergeSessionIds({ 'nonexistent': 'some-session' })).not.toThrow();
    });
  });

  // ── logIntentEvent / listIntentEvents ──────────────────

  describe('logIntentEvent / listIntentEvents', () => {
    it('logs events and retrieves them with joins', () => {
      const intent = makeIntent('Event test');

      logIntentEvent(intent.id, 'due_at.set', {
        due_at: '2024-12-25',
        due_at_utc: '2024-12-25T00:00:00Z',
      });

      logIntentEvent(intent.id, 'completed', {
        completed_at: '2024-12-20T10:00:00Z',
      });

      expect(appendEvent).toHaveBeenCalledWith(
        expect.any(String),
        'intent_event.log',
        expect.objectContaining({ intent_id: intent.id, event_type: 'due_at.set' }),
      );

      const events = listIntentEvents();
      expect(events).toHaveLength(2);
      const types = events.map(e => e.event_type).sort();
      expect(types).toEqual(['completed', 'due_at.set']);
      // Join brings in intent data
      expect(events[0].intent_description).toBe(intent.description);
    });

    it('respects the limit parameter', () => {
      const intent = makeIntent();
      logIntentEvent(intent.id, 'event-1');
      logIntentEvent(intent.id, 'event-2');
      logIntentEvent(intent.id, 'event-3');

      const events = listIntentEvents(2);
      expect(events).toHaveLength(2);
    });

    it('cascades delete — events removed when intent is deleted', () => {
      const intent = makeIntent();
      logIntentEvent(intent.id, 'some-event');
      deleteIntent(intent.id);

      // ON DELETE CASCADE removes associated intent_events
      const events = listIntentEvents();
      expect(events).toHaveLength(0);
    });
  });

  // ── setIntentSessionId ─────────────────────────────────

  describe('setIntentSessionId', () => {
    it('updates session_id directly on an intent', () => {
      const intent = makeIntent();
      expect(intent.session_id).toBeNull();

      setIntentSessionId(intent.id, 'direct-session-id');

      const fetched = getIntent(intent.id);
      expect(fetched!.session_id).toBe('direct-session-id');
    });

    it('does not log to event log (per-machine only)', () => {
      const intent = makeIntent();
      vi.clearAllMocks();

      setIntentSessionId(intent.id, 'sess-xyz');
      expect(appendEvent).not.toHaveBeenCalled();
    });
  });

  // ── updateIntent field coverage ────────────────────────

  describe('updateIntent field coverage', () => {
    it('updates all supported fields', () => {
      const intent = makeIntent();
      const updated = updateIntent(intent.id, {
        description: 'New desc',
        body: 'New body',
        client: 'test-client',
        due_at: '2024-12-31',
        due_at_utc: '2024-12-31T00:00:00Z',
        recurrence: '{"freq":"weekly"}',
        completed_at: '2024-12-30T12:00:00Z',
        status: 'done',
        attachments: [{ type: 'url', name: 'Link', url: 'https://example.com' }],
      });

      expect(updated!.description).toBe('New desc');
      expect(updated!.body).toBe('New body');
      expect(updated!.client).toBe('test-client');
      expect(updated!.due_at).toBe('2024-12-31');
      expect(updated!.due_at_utc).toBe('2024-12-31T00:00:00Z');
      expect(updated!.recurrence).toBe('{"freq":"weekly"}');
      expect(updated!.completed_at).toBe('2024-12-30T12:00:00Z');
      expect(updated!.status).toBe('done');
      expect(updated!.attachments).toHaveLength(1);
    });

    it('returns null when updating non-existent intent', () => {
      const result = updateIntent('nonexistent', { description: 'nope' });
      // appendEvent is still called (log-first), but getIntent returns null
      expect(result).toBeNull();
    });
  });
});
