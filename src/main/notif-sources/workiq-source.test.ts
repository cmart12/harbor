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
    this.emit('exit', 0);
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

// SDK mock: a session whose sendAndWait we can override per test
const sdkState: {
  client: unknown;
  session: { sendAndWait: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } | null;
  createSession: ReturnType<typeof vi.fn>;
} = {
  client: null,
  session: null,
  createSession: vi.fn(),
};

function makeSession(text: string) {
  return {
    sendAndWait: vi.fn().mockResolvedValue({ data: { content: text } }),
    disconnect: vi.fn(),
  };
}

vi.mock('../ai', () => ({
  getEphemeralCopilotClient: () => sdkState.client,
}));

vi.mock('../agents/in-memory-fs-provider', () => ({
  InMemoryFsProvider: vi.fn(),
}));

vi.mock('../main-log', () => ({
  mainLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  initMainLog: vi.fn(),
}));

const mcpServersStore: { value: Record<string, unknown> } = { value: {} };
vi.mock('../mcp', () => ({
  getAllMcpServers: () => mcpServersStore.value,
}));

// ---------------------------------------------------------------------------
// Import after mocks are defined
// ---------------------------------------------------------------------------

import { WorkIQNotifSource, _setClientFactory, _resetClientFactoryForTests, workiqApprovalHandler } from './workiq-source';
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
    sdkState.client = null;
    sdkState.session = null;
    sdkState.createSession = vi.fn();
    mcpServersStore.value = {};
    _resetClientFactoryForTests();
    source = new WorkIQNotifSource();
  });

  afterEach(async () => {
    await source.stop();
    _resetClientFactoryForTests();
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

  it('writes last_poll_iso on every successful poll (including zero items)', async () => {
    // Seed a stale crash error to confirm a healthy zero-item poll clears
    // it AND writes last_poll_iso. This was the regression that left both
    // WorkIQ sources stuck on "Worker crashed repeatedly" forever.
    settingsStore['workiq-outlook'] = { last_error: 'Worker crashed repeatedly' };
    settingsStore['workiq-teams'] = { last_error: 'Worker crashed repeatedly' };

    await source.start();
    const before = Date.now();
    lastMockWorker!.emit('message', {
      type: 'notifications',
      items: [],
      cursor: '2025-06-17T12:00:00Z',
    });

    for (const src of ['workiq-outlook', 'workiq-teams']) {
      const polled = settingsStore[src]?.last_poll_iso;
      expect(polled, `${src} last_poll_iso`).toBeTruthy();
      expect(new Date(polled as string).getTime()).toBeGreaterThanOrEqual(before - 100);
      expect(settingsStore[src]?.last_error, `${src} last_error`).toBeNull();
    }
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

  it('persists the raw worker error in last_error when worker crashes repeatedly', async () => {
    await source.start();
    const worker = lastMockWorker!;

    // Simulate a real worker crash: an Error event with message + stack,
    // followed by exit. Repeat past MAX_RESTARTS (2) so the orchestrator
    // gives up. The persisted last_error must include the actual cause,
    // not just the generic 'Worker crashed repeatedly' string.
    const realError = new Error("Cannot find module 'electron'");
    realError.stack = "Error: Cannot find module 'electron'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1234:5)\n    at Module._load";

    // First crash
    worker.emit('error', realError);
    worker.emit('exit', 1);
    // Wait for the restart timer to elapse (RESTART_BACKOFF_MS = 10s).
    // Using fake timers would be ideal, but for this test we just emit
    // additional crashes through the same worker reference: each emit
    // bumps restartCount via the same worker because spawnWorker reuses
    // the same MockWorker constructor pattern. To force the final crash
    // synchronously, manipulate the counter via repeated error+exit:
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(11_000);
      // The orchestrator spawned a new worker; use the latest reference
      const w2 = lastMockWorker!;
      w2.emit('error', realError);
      w2.emit('exit', 1);
      vi.advanceTimersByTime(11_000);
      const w3 = lastMockWorker!;
      w3.emit('error', realError);
      w3.emit('exit', 1);
      vi.advanceTimersByTime(11_000);
    } finally {
      vi.useRealTimers();
    }

    const persisted = settingsStore['workiq-outlook']?.last_error;
    expect(persisted).toBeTruthy();
    expect(persisted).toContain("Cannot find module 'electron'");
    // And it must NOT be the bare generic fallback string
    expect(persisted).not.toBe('Worker crashed repeatedly');
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
    lastMockWorker!.emit('message', {
      type: 'log', level: 'info', message: 'Poll completed',
    });
    lastMockWorker!.emit('message', {
      type: 'log', level: 'warn', message: 'Rate limited',
    });
    lastMockWorker!.emit('message', {
      type: 'log', level: 'error', message: 'Something broke',
    });
  });

  // ── SDK round-trip (request-poll / sdk-response) ──────

  it('responds to request-poll by calling SDK and posting sdk-response', async () => {
    const session = makeSession('[{"source":"workiq-outlook","source_uid":"a"}]');
    sdkState.session = session;
    sdkState.client = {
      createSession: vi.fn().mockResolvedValue(session),
    };
    _setClientFactory(() => sdkState.client as any);

    await source.start();
    lastMockWorker!.emit('message', {
      type: 'request-poll',
      id: 'req-1',
      prompt: 'List my emails',
    });

    // Wait for the async SDK call + postMessage to flush
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    expect(session.sendAndWait).toHaveBeenCalledWith(
      { prompt: 'List my emails' },
      expect.any(Number),
    );
    const responseMsg = lastMockWorker!.postMessages.find(
      (m: any) => m.type === 'sdk-response' && m.id === 'req-1'
    ) as any;
    expect(responseMsg).toBeDefined();
    expect(responseMsg.success).toBe(true);
    expect(responseMsg.text).toContain('workiq-outlook');
  });

  it('posts sdk-response error when SDK client is unavailable', async () => {
    _setClientFactory(() => null);
    await source.start();
    lastMockWorker!.emit('message', {
      type: 'request-poll',
      id: 'req-noclient',
      prompt: 'p',
    });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    const responseMsg = lastMockWorker!.postMessages.find(
      (m: any) => m.type === 'sdk-response' && m.id === 'req-noclient'
    ) as any;
    expect(responseMsg).toBeDefined();
    expect(responseMsg.success).toBe(false);
    expect(responseMsg.error).toMatch(/SDK session/i);
  });

  it('posts sdk-response error when SDK throws', async () => {
    const session = {
      sendAndWait: vi.fn().mockRejectedValue(new Error('rate limited')),
      disconnect: vi.fn(),
    };
    sdkState.client = { createSession: vi.fn().mockResolvedValue(session) };
    _setClientFactory(() => sdkState.client as any);

    await source.start();
    lastMockWorker!.emit('message', {
      type: 'request-poll',
      id: 'req-err',
      prompt: 'p',
    });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    const responseMsg = lastMockWorker!.postMessages.find(
      (m: any) => m.type === 'sdk-response' && m.id === 'req-err'
    ) as any;
    expect(responseMsg).toBeDefined();
    expect(responseMsg.success).toBe(false);
    expect(responseMsg.error).toBe('rate limited');
  });

  it('does not import electron in the worker (worker file is electron-free)', async () => {
    // Reading the worker source as a string to assert no SDK / electron imports.
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, 'workiq-worker.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/from ['"]electron['"]/);
    expect(src).not.toMatch(/from ['"]\.\.\/ai['"]/);
    expect(src).not.toMatch(/@github\/copilot-sdk/);
  });

  // ── MCP wiring ─────────────────────────────────────────

  it('passes the workiq MCP server into createSession options', async () => {
    const session = makeSession('[]');
    const createSession = vi.fn().mockResolvedValue(session);
    sdkState.client = { createSession };
    _setClientFactory(() => sdkState.client as any);
    mcpServersStore.value = {
      workiq: { type: 'stdio', command: 'workiq-mcp' },
      datadog: { type: 'http', url: 'https://dd.example.com' },
      kusto: { type: 'stdio', command: 'kusto-mcp' },
    };

    await source.start();
    lastMockWorker!.emit('message', {
      type: 'request-poll', id: 'r1', prompt: 'p',
    });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    expect(createSession).toHaveBeenCalled();
    const opts = createSession.mock.calls[0][0];
    expect(opts.mcpServers).toBeDefined();
    expect(opts.mcpServers).toHaveProperty('workiq');
    // No other MCPs should leak in
    expect(opts.mcpServers).not.toHaveProperty('datadog');
    expect(opts.mcpServers).not.toHaveProperty('kusto');
    expect(Object.keys(opts.mcpServers)).toEqual(['workiq']);
  });

  it('omits mcpServers from createSession when no workiq MCP is discovered', async () => {
    const session = makeSession('[]');
    const createSession = vi.fn().mockResolvedValue(session);
    sdkState.client = { createSession };
    _setClientFactory(() => sdkState.client as any);
    mcpServersStore.value = {
      datadog: { type: 'http', url: 'https://dd.example.com' },
    };

    await source.start();
    lastMockWorker!.emit('message', {
      type: 'request-poll', id: 'r1', prompt: 'p',
    });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    expect(createSession).toHaveBeenCalled();
    const opts = createSession.mock.calls[0][0];
    expect(opts.mcpServers).toBeUndefined();
  });

  it('passes the workiq approval allowlist as onPermissionRequest', async () => {
    const session = makeSession('[]');
    const createSession = vi.fn().mockResolvedValue(session);
    sdkState.client = { createSession };
    _setClientFactory(() => sdkState.client as any);
    mcpServersStore.value = { workiq: { type: 'stdio', command: 'wiq' } };

    await source.start();
    lastMockWorker!.emit('message', { type: 'request-poll', id: 'r1', prompt: 'p' });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    const opts = createSession.mock.calls[0][0];
    expect(opts.onPermissionRequest).toBe(workiqApprovalHandler);
  });
});

// ---------------------------------------------------------------------------
// workiqApprovalHandler: standalone unit tests for the allowlist policy.
// ---------------------------------------------------------------------------

describe('workiqApprovalHandler', () => {
  it('approves workiq MCP tool calls', async () => {
    const result = await workiqApprovalHandler({
      kind: 'mcp', serverName: 'workiq', toolName: 'fetch', toolTitle: 'Fetch', readOnly: true,
    });
    expect(result.kind).toBe('approve-once');
  });

  it('rejects non-workiq MCP tool calls', async () => {
    const result = await workiqApprovalHandler({
      kind: 'mcp', serverName: 'datadog', toolName: 'search_logs', toolTitle: 'Search Logs', readOnly: true,
    });
    expect(result.kind).toBe('reject');
  });

  it('approves workiq extension permission access (e.g. EULA)', async () => {
    const result = await workiqApprovalHandler({
      kind: 'extension-permission-access', extensionName: 'workiq', capabilities: ['eula'],
    });
    expect(result.kind).toBe('approve-once');
  });

  it('rejects non-workiq extension permission access', async () => {
    const result = await workiqApprovalHandler({
      kind: 'extension-permission-access', extensionName: 'datadog', capabilities: ['eula'],
    });
    expect(result.kind).toBe('reject');
  });

  it('approves workiq extension management', async () => {
    const result = await workiqApprovalHandler({
      kind: 'extension-management', extensionName: 'workiq', operation: 'reload',
    });
    expect(result.kind).toBe('approve-once');
  });

  it('approves harmless reads', async () => {
    const result = await workiqApprovalHandler({ kind: 'read' });
    expect(result.kind).toBe('approve-once');
  });

  it('rejects shell, write, url, memory, custom-tool, hook', async () => {
    for (const kind of ['shell', 'write', 'url', 'memory', 'custom-tool', 'hook']) {
      const result = await workiqApprovalHandler({ kind });
      expect(result.kind, kind).toBe('reject');
    }
  });
});
