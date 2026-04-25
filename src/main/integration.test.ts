import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock electron (required by config.ts dependency chain)
vi.mock('electron', () => ({
  app: { getPath: () => '/mock/electron-path' },
}));

// Mock workspace — readCanvas is called by syncCanvasContent during rebuild
vi.mock('./workspace', () => ({
  readCanvas: vi.fn(() => ''),
}));

// Do NOT mock eventlog or database — the whole point is testing them together

import {
  initDatabase,
  createIntent,
  getIntent,
  listIntents,
  updateIntent,
  updateIntentCAS,
  deleteIntent,
  assignIntentFolder,
  logIntentEvent,
  listIntentEvents,
  createCanvasAgent,
  updateCanvasAgentStatus,
  listCanvasAgents,
  createAgentSession,
  updateAgentSessionStatus,
  getAgentSession,
} from './database';
import type { CanvasAgent, AgentSession } from '../shared/types';

let testDir: string;
let dbPath: string;
let eventLogPath: string;

function setup() {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-integration-'));
  dbPath = path.join(testDir, 'test.db');
  eventLogPath = path.join(testDir, 'events.jsonl');
  initDatabase(dbPath, eventLogPath);
}

function rebuild() {
  initDatabase(dbPath, eventLogPath);
}

function makeCanvasAgent(intentId: string, overrides: Partial<CanvasAgent> = {}): CanvasAgent {
  const now = new Date().toISOString();
  return {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    intent_id: intentId,
    selected_text: 'some selected text',
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
    id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    session_id: 'sess-1',
    intent_id: null,
    prompt: 'do something',
    status: 'running',
    summary: '',
    working_dir: null,
    source: 'sdk',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setup();
});

afterEach(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }
});

describe('Event log ↔ Database integration', () => {
  // ── 1. Full round-trip: create → verify → rebuild ────────
  describe('full round-trip: create → verify → rebuild', () => {
    it('intents survive a full DB rebuild from the event log', () => {
      const i1 = createIntent({ body: 'Buy groceries' });
      const i2 = createIntent({ body: 'Write tests' });

      // Verify they exist in memory DB
      expect(getIntent(i1.id)).not.toBeNull();
      expect(getIntent(i2.id)).not.toBeNull();
      expect(listIntents()).toHaveLength(2);

      // Rebuild: delete DB, replay log
      rebuild();

      const r1 = getIntent(i1.id)!;
      const r2 = getIntent(i2.id)!;
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r1.description).toBe(i1.description);
      expect(r1.body).toBe('Buy groceries');
      expect(r1.status).toBe('captured');
      expect(r1.created_at).toBe(i1.created_at);
      expect(r2.body).toBe('Write tests');
      expect(listIntents()).toHaveLength(2);
    });
  });

  // ── 2. Update + rebuild ──────────────────────────────────
  describe('update + rebuild', () => {
    it('updated fields survive a DB rebuild', () => {
      const intent = createIntent({ body: 'Original body' });
      const dueDate = '2025-12-31';
      updateIntent(intent.id, {
        description: 'Updated description',
        status: 'in_progress',
        due_at: dueDate,
      });

      // Verify pre-rebuild
      const before = getIntent(intent.id)!;
      expect(before.description).toBe('Updated description');
      expect(before.status).toBe('in_progress');
      expect(before.due_at).toBe(dueDate);

      rebuild();

      const after = getIntent(intent.id)!;
      expect(after.description).toBe('Updated description');
      expect(after.status).toBe('in_progress');
      expect(after.due_at).toBe(dueDate);
    });
  });

  // ── 3. Delete + rebuild ──────────────────────────────────
  describe('delete + rebuild', () => {
    it('deleted intent is gone after rebuild', () => {
      const i1 = createIntent({ body: 'First' });
      const i2 = createIntent({ body: 'Second (to delete)' });
      const i3 = createIntent({ body: 'Third' });

      deleteIntent(i2.id);
      expect(listIntents()).toHaveLength(2);

      rebuild();

      expect(listIntents()).toHaveLength(2);
      expect(getIntent(i2.id)).toBeNull();
      expect(getIntent(i1.id)).not.toBeNull();
      expect(getIntent(i3.id)).not.toBeNull();
    });
  });

  // ── 4. CAS update + event log ────────────────────────────
  describe('CAS update + event log', () => {
    it('only successful CAS update is reflected after rebuild', () => {
      const intent = createIntent({ body: 'CAS test' });
      const v1 = intent.updated_at;

      // Successful CAS update
      const updated = updateIntentCAS(intent.id, v1, {
        description: 'CAS succeeded',
      });
      expect(updated).not.toBeNull();
      expect(updated!.description).toBe('CAS succeeded');

      // Failed CAS update with stale version
      const failed = updateIntentCAS(intent.id, v1, {
        description: 'Should not apply',
      });
      expect(failed).toBeNull();

      rebuild();

      const after = getIntent(intent.id)!;
      expect(after.description).toBe('CAS succeeded');
    });
  });

  // ── 5. Canvas agent lifecycle via events ──────────────────
  describe('canvas agent lifecycle via events', () => {
    it('canvas agent survives rebuild with correct final status', () => {
      const intent = createIntent({ body: 'Agent test' });
      const agent = makeCanvasAgent(intent.id);
      createCanvasAgent(agent);

      // Verify pre-rebuild
      const agentsBefore = listCanvasAgents(intent.id);
      expect(agentsBefore).toHaveLength(1);
      expect(agentsBefore[0].status).toBe('running');

      // Update status
      updateCanvasAgentStatus(agent.id, 'completed');

      rebuild();

      const agentsAfter = listCanvasAgents(intent.id);
      expect(agentsAfter).toHaveLength(1);
      expect(agentsAfter[0].id).toBe(agent.id);
      expect(agentsAfter[0].status).toBe('completed');
      expect(agentsAfter[0].intent_id).toBe(intent.id);
      expect(agentsAfter[0].selected_text).toBe('some selected text');
    });
  });

  // ── 6. Agent session lifecycle via events ─────────────────
  describe('agent session lifecycle via events', () => {
    it('agent session state matches after rebuild', () => {
      const intent = createIntent({ body: 'Session test' });
      const session = makeAgentSession({ intent_id: intent.id });
      createAgentSession(session);

      // Update status and summary
      updateAgentSessionStatus(session.id, 'completed', 'Task finished successfully');

      const before = getAgentSession(session.id)!;
      expect(before.status).toBe('completed');
      expect(before.summary).toBe('Task finished successfully');

      rebuild();

      const after = getAgentSession(session.id)!;
      expect(after).not.toBeNull();
      expect(after.status).toBe('completed');
      expect(after.summary).toBe('Task finished successfully');
      expect(after.prompt).toBe('do something');
      expect(after.intent_id).toBe(intent.id);
    });
  });

  // ── 7. Intent events survive rebuild ──────────────────────
  describe('intent events survive rebuild', () => {
    it('logIntentEvent entries are present after rebuild', () => {
      const intent = createIntent({ body: 'Event test' });

      logIntentEvent(intent.id, 'scheduled', {
        due_at: '2025-06-15',
        due_at_utc: '2025-06-15T00:00:00Z',
      });
      logIntentEvent(intent.id, 'completed', {
        completed_at: '2025-06-15T10:00:00Z',
      });

      const eventsBefore = listIntentEvents();
      expect(eventsBefore).toHaveLength(2);

      rebuild();

      const eventsAfter = listIntentEvents();
      expect(eventsAfter).toHaveLength(2);

      const scheduled = eventsAfter.find(e => e.event_type === 'scheduled')!;
      expect(scheduled).toBeDefined();
      expect(scheduled.intent_id).toBe(intent.id);
      expect(scheduled.due_at).toBe('2025-06-15');
      expect(scheduled.due_at_utc).toBe('2025-06-15T00:00:00Z');

      const completed = eventsAfter.find(e => e.event_type === 'completed')!;
      expect(completed).toBeDefined();
      expect(completed.completed_at).toBe('2025-06-15T10:00:00Z');
    });
  });

  // ── 8. Folder assignment survives rebuild ─────────────────
  describe('folder assignment survives rebuild', () => {
    it('assigned folder is set after rebuild', () => {
      const intent = createIntent({ body: 'Folder test' });
      expect(getIntent(intent.id)!.folder).toBeNull();

      assignIntentFolder(intent.id, 'my-project-folder');

      expect(getIntent(intent.id)!.folder).toBe('my-project-folder');

      rebuild();

      const after = getIntent(intent.id)!;
      expect(after.folder).toBe('my-project-folder');
    });
  });
});
