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
  createSpace,
  getSpace,
  listSpaces,
  updateSpace,
  updateSpaceCAS,
  deleteSpace,
  assignSpaceFolder,
  logSpaceEvent,
  listSpaceEvents,
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
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-integration-'));
  dbPath = path.join(testDir, 'test.db');
  eventLogPath = path.join(testDir, 'events.jsonl');
  initDatabase(dbPath, eventLogPath);
}

function rebuild() {
  initDatabase(dbPath, eventLogPath);
}

function makeCanvasAgent(spaceId: string, overrides: Partial<CanvasAgent> = {}): CanvasAgent {
  const now = new Date().toISOString();
  return {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    space_id: spaceId,
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
    space_id: null,
    prompt: 'do something',
    status: 'running',
    summary: '',
    working_dir: null,
    source: 'sdk',
    persona_handle: null,
    quoted_text: null,
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
    it('spaces survive a full DB rebuild from the event log', () => {
      const i1 = createSpace({ body: 'Buy groceries' });
      const i2 = createSpace({ body: 'Write tests' });

      // Verify they exist in memory DB
      expect(getSpace(i1.id)).not.toBeNull();
      expect(getSpace(i2.id)).not.toBeNull();
      expect(listSpaces()).toHaveLength(2);

      // Rebuild: delete DB, replay log
      rebuild();

      const r1 = getSpace(i1.id)!;
      const r2 = getSpace(i2.id)!;
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r1.description).toBe(i1.description);
      expect(r1.body).toBe('Buy groceries');
      expect(r1.status).toBe('captured');
      expect(r1.created_at).toBe(i1.created_at);
      expect(r2.body).toBe('Write tests');
      expect(listSpaces()).toHaveLength(2);
    });
  });

  // ── 2. Update + rebuild ──────────────────────────────────
  describe('update + rebuild', () => {
    it('updated fields survive a DB rebuild', () => {
      const space = createSpace({ body: 'Original body' });
      const dueDate = '2025-12-31';
      updateSpace(space.id, {
        description: 'Updated description',
        status: 'in_progress',
        due_at: dueDate,
      });

      // Verify pre-rebuild
      const before = getSpace(space.id)!;
      expect(before.description).toBe('Updated description');
      expect(before.status).toBe('in_progress');
      expect(before.due_at).toBe(dueDate);

      rebuild();

      const after = getSpace(space.id)!;
      expect(after.description).toBe('Updated description');
      expect(after.status).toBe('in_progress');
      expect(after.due_at).toBe(dueDate);
    });
  });

  // ── 3. Delete + rebuild ──────────────────────────────────
  describe('delete + rebuild', () => {
    it('deleted space is gone after rebuild', () => {
      const i1 = createSpace({ body: 'First' });
      const i2 = createSpace({ body: 'Second (to delete)' });
      const i3 = createSpace({ body: 'Third' });

      deleteSpace(i2.id);
      expect(listSpaces()).toHaveLength(2);

      rebuild();

      expect(listSpaces()).toHaveLength(2);
      expect(getSpace(i2.id)).toBeNull();
      expect(getSpace(i1.id)).not.toBeNull();
      expect(getSpace(i3.id)).not.toBeNull();
    });
  });

  // ── 4. CAS update + event log ────────────────────────────
  describe('CAS update + event log', () => {
    it('only successful CAS update is reflected after rebuild', () => {
      const space = createSpace({ body: 'CAS test' });
      const v1 = space.updated_at;

      // Successful CAS update
      const updated = updateSpaceCAS(space.id, v1, {
        description: 'CAS succeeded',
      });
      expect(updated).not.toBeNull();
      expect(updated!.description).toBe('CAS succeeded');

      // Failed CAS update with stale version
      const failed = updateSpaceCAS(space.id, v1, {
        description: 'Should not apply',
      });
      expect(failed).toBeNull();

      rebuild();

      const after = getSpace(space.id)!;
      expect(after.description).toBe('CAS succeeded');
    });
  });

  // ── 5. Canvas agent lifecycle via events ──────────────────
  describe('canvas agent lifecycle via events', () => {
    it('canvas agent survives rebuild with correct final status', () => {
      const space = createSpace({ body: 'Agent test' });
      const agent = makeCanvasAgent(space.id);
      createCanvasAgent(agent);

      // Verify pre-rebuild
      const agentsBefore = listCanvasAgents(space.id);
      expect(agentsBefore).toHaveLength(1);
      expect(agentsBefore[0].status).toBe('running');

      // Update status
      updateCanvasAgentStatus(agent.id, 'completed');

      rebuild();

      const agentsAfter = listCanvasAgents(space.id);
      expect(agentsAfter).toHaveLength(1);
      expect(agentsAfter[0].id).toBe(agent.id);
      expect(agentsAfter[0].status).toBe('completed');
      expect(agentsAfter[0].space_id).toBe(space.id);
      expect(agentsAfter[0].selected_text).toBe('some selected text');
    });
  });

  // ── 6. Agent session lifecycle via events ─────────────────
  describe('agent session lifecycle via events', () => {
    it('agent session state matches after rebuild', () => {
      const space = createSpace({ body: 'Session test' });
      const session = makeAgentSession({ space_id: space.id });
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
      expect(after.space_id).toBe(space.id);
    });
  });

  // ── 7. Space events survive rebuild ──────────────────────
  describe('space events survive rebuild', () => {
    it('logSpaceEvent entries are present after rebuild', () => {
      const space = createSpace({ body: 'Event test' });

      logSpaceEvent(space.id, 'scheduled', {
        due_at: '2025-06-15',
        due_at_utc: '2025-06-15T00:00:00Z',
      });
      logSpaceEvent(space.id, 'completed', {
        completed_at: '2025-06-15T10:00:00Z',
      });

      const eventsBefore = listSpaceEvents();
      expect(eventsBefore).toHaveLength(2);

      rebuild();

      const eventsAfter = listSpaceEvents();
      expect(eventsAfter).toHaveLength(2);

      const scheduled = eventsAfter.find(e => e.event_type === 'scheduled')!;
      expect(scheduled).toBeDefined();
      expect(scheduled.space_id).toBe(space.id);
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
      const space = createSpace({ body: 'Folder test' });
      expect(getSpace(space.id)!.folder).toBeNull();

      assignSpaceFolder(space.id, 'my-project-folder');

      expect(getSpace(space.id)!.folder).toBe('my-project-folder');

      rebuild();

      const after = getSpace(space.id)!;
      expect(after.folder).toBe('my-project-folder');
    });
  });
});
