/**
 * WorkIQ notification source orchestrator tests (Phase C.1).
 *
 * Mocks worker_threads, notif-db, and IPC to test the orchestrator
 * in isolation. No real network or SDK calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mocks (must be defined before importing the module under test)
// ---------------------------------------------------------------------------

// Mock worker that simulates the worker_threads.Worker interface
class MockWorker extends EventEmitter {
  postMessages: unknown[] = [];
  terminated = false;
  constructor(_path: string) {
    super();
  }
  postMessage(msg: unknown): void {
    this.postMessages.push(msg);
  }
  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }
}

let lastMockWorker: MockWorker | null = null;

vi.mock('worker_threads', () => ({
  Worker: class {
    constructor(path: string) {
      const w = new MockWorker(path);
      lastMockWorker = w;
      return w as unknown;
    }
  },
}));

const insertedNotifications: unknown[] = [];
const settingsStore: Record<string, Record<string, unknown>> = {};

vi.mock('../notif-db', () => ({
  insertNotification: (input: unknown) => {
    insertedNotifications.push(input);
    return true;
  },
  getNotification: (uid: string) => ({
    source_uid: uid,
    source: 'workiq-outlook',
    app_id: null,
    sender_name: 'Test',
    sender_email: 'test@test.com',
    subject: 'Test',
    body: 'Test body',
    received_at: '2025-06-17T10:00:00Z',
    deep_link: null,
    status: 'unread',
    goal_id: null,
    category_id: null,
    promoted_space: null,
    created_at: '2025-06-17T10:00:00Z',
  }),
  getSourceSettings: (source: string) => settingsStore[source] ?? null,
  setSourceSettings: (source: string, patch: Record<string, unknown>) => {
    settingsStore[source] = { ...settingsStore[source], ...patch };
  },
}));

vi.mock('../ipc/typed-handler', () => ({
  sendToAllWindows: vi.fn(),
}));

vi.mock('../classifier/classifier', () => ({
  enqueueForClassification: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks are defined
// ---------------------------------------------------------------------------

import { WorkIQNotifSource } from './workiq-source';
import { sendToAllWindows } from '../ipc/typed-handler';
import { enqueueForClassification } from '../classifier/classifier';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkIQNotifSource', () => {
  let source: WorkIQNotifSource;

  beforeEach(() => {
    lastMockWorker = null;
    insertedNotifications.length = 0;
    Object.keys(settingsStore).forEach(k => delete settingsStore[k]);
    vi.clearAllMocks();
    source = new WorkIQNotifSource();
  });

  afterEach(async () => {
    await source.stop();
  });

  // ── Lifecycle ──────────────────────────────────────────

  it('spawns a worker on start()', async () => {
    await source.start();
    expect(lastMockWorker).not.toBeNull();
    // Worker should receive an 'init' message
    const initMsg = lastMockWorker!.postMessages.find(
      (m: any) => m.type === 'init'
    );
    expect(initMsg).toBeDefined();
  });

  it('sends stop to worker and terminates on stop()', async () => {
    await source.start();
    const worker = lastMockWorker!;
    await source.stop();
    const stopMsg = worker.postMessages.find(
      (m: any) => m.type === 'stop'
    );
    expect(stopMsg).toBeDefined();
    expect(worker.terminated).toBe(true);
  });

  it('is idempotent: calling start() twice does not spawn a second worker', async () => {
    await source.start();
    const first = lastMockWorker;
    await source.start();
    expect(lastMockWorker).toBe(first);
  });

  // ── pollNow ────────────────────────────────────────────

  it('sends poll-now to the worker', async () => {
    await source.start();
    source.pollNow();
    const pollMsg = lastMockWorker!.postMessages.find(
      (m: any) => m.type === 'poll-now'
    );
    expect(pollMsg).toBeDefined();
  });

  // ── Notification insertion ─────────────────────────────

  it('inserts notifications into the DB when worker sends items', async () => {
    await source.start();
    const worker = lastMockWorker!;

    // Simulate worker posting notifications
    worker.emit('message', {
      type: 'notifications',
      items: [
        {
          source: 'workiq-outlook',
          source_uid: 'outlook-uid-1',
          sender_name: 'Alice',
          sender_email: 'alice@example.com',
          subject: 'Hello',
          body: 'World',
          received_at: '2025-06-17T10:00:00Z',
          deep_link: 'https://outlook.office.com/mail/id/1',
        },
      ],
      cursor: '2025-06-17T10:00:00Z',
    });

    expect(insertedNotifications).toHaveLength(1);
    expect((insertedNotifications[0] as any).source_uid).toBe('outlook-uid-1');
    expect((insertedNotifications[0] as any).source).toBe('workiq-outlook');
  });

  it('emits notification:new IPC event for inserted items', async () => {
    await source.start();
    const worker = lastMockWorker!;

    worker.emit('message', {
      type: 'notifications',
      items: [
        {
          source: 'workiq-teams',
          source_uid: 'teams-uid-1',
          sender_name: 'Bob',
          sender_email: 'bob@example.com',
          subject: 'Chat',
          body: 'Hey',
          received_at: '2025-06-17T11:00:00Z',
          deep_link: null,
        },
      ],
      cursor: '2025-06-17T11:00:00Z',
    });

    expect(sendToAllWindows).toHaveBeenCalledWith('notification:new', expect.any(Object));
  });

  it('enqueues inserted notifications for classification', async () => {
    await source.start();
    lastMockWorker!.emit('message', {
      type: 'notifications',
      items: [
        {
          source: 'workiq-outlook',
          source_uid: 'classify-uid',
          sender_name: 'Test',
          sender_email: 'test@test.com',
          subject: 'Classify me',
          body: 'Body',
          received_at: '2025-06-17T10:00:00Z',
          deep_link: null,
        },
      ],
      cursor: '2025-06-17T10:00:00Z',
    });

    expect(enqueueForClassification).toHaveBeenCalledWith('classify-uid');
  });

  // ── Cursor management ──────────────────────────────────

  it('updates source_settings cursor after successful poll', async () => {
    await source.start();
    lastMockWorker!.emit('message', {
      type: 'notifications',
      items: [],
      cursor: '2025-06-17T12:00:00Z',
    });

    expect(settingsStore['workiq-outlook']?.last_cursor_iso).toBe('2025-06-17T12:00:00Z');
    expect(settingsStore['workiq-teams']?.last_cursor_iso).toBe('2025-06-17T12:00:00Z');
  });

  it('clears last_error on successful poll', async () => {
    settingsStore['workiq-outlook'] = { last_error: 'previous error' };
    settingsStore['workiq-teams'] = { last_error: 'previous error' };

    await source.start();
    lastMockWorker!.emit('message', {
      type: 'notifications',
      items: [],
      cursor: '2025-06-17T12:00:00Z',
    });

    expect(settingsStore['workiq-outlook']?.last_error).toBeNull();
    expect(settingsStore['workiq-teams']?.last_error).toBeNull();
  });

  // ── Error handling ─────────────────────────────────────

  it('persists error to source_settings when worker sends error', async () => {
    await source.start();
    lastMockWorker!.emit('message', {
      type: 'error',
      error: 'SDK connection failed',
    });

    expect(settingsStore['workiq-outlook']?.last_error).toBe('SDK connection failed');
    expect(settingsStore['workiq-teams']?.last_error).toBe('SDK connection failed');
  });

  it('broadcasts source:status-changed on error', async () => {
    await source.start();
    lastMockWorker!.emit('message', {
      type: 'error',
      error: 'Some error',
    });

    expect(sendToAllWindows).toHaveBeenCalledWith('source:status-changed');
  });

  // ── Cursor seeding ─────────────────────────────────────

  it('uses earliest cursor from both sources on init', async () => {
    settingsStore['workiq-outlook'] = { last_cursor_iso: '2025-06-15T00:00:00Z' };
    settingsStore['workiq-teams'] = { last_cursor_iso: '2025-06-10T00:00:00Z' };

    await source.start();
    const initMsg = lastMockWorker!.postMessages.find(
      (m: any) => m.type === 'init'
    ) as any;
    // Should use the earlier cursor
    expect(initMsg.cursor).toBe('2025-06-10T00:00:00Z');
  });

  it('sends null cursor when no settings exist', async () => {
    await source.start();
    const initMsg = lastMockWorker!.postMessages.find(
      (m: any) => m.type === 'init'
    ) as any;
    expect(initMsg.cursor).toBeNull();
  });

  // ── Log passthrough ────────────────────────────────────

  it('handles log messages without crashing', async () => {
    await source.start();
    // Should not throw
    lastMockWorker!.emit('message', {
      type: 'log',
      level: 'info',
      message: 'Poll completed',
    });
    lastMockWorker!.emit('message', {
      type: 'log',
      level: 'warn',
      message: 'Rate limited',
    });
    lastMockWorker!.emit('message', {
      type: 'log',
      level: 'error',
      message: 'Something broke',
    });
  });
});
