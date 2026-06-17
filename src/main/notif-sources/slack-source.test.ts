/**
 * Slack notification source orchestrator tests (Phase C.4).
 *
 * Mocks worker_threads, notif-db, and IPC to test the orchestrator
 * in isolation. Mirrors workiq-source.test.ts structure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mocks (must be defined before importing the module under test)
// ---------------------------------------------------------------------------

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
    source: 'slack',
    app_id: null,
    sender_name: 'Test',
    sender_email: 'test@test.com',
    subject: '#general',
    body: 'Test message',
    received_at: '2026-06-17T10:00:00Z',
    deep_link: null,
    status: 'unread',
    goal_id: null,
    category_id: null,
    promoted_space: null,
    created_at: '2026-06-17T10:00:00Z',
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
  safeStringify: (v: unknown) => {
    try { return JSON.stringify(v); } catch { return String(v); }
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

import { SlackNotifSource, _setClientFactory, _resetClientFactoryForTests, slackApprovalHandler } from './slack-source';
import { sendToAllWindows } from '../ipc/typed-handler';
import { enqueueForClassification } from '../classifier/classifier';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlackNotifSource', () => {
  let source: SlackNotifSource;

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
    source = new SlackNotifSource();
  });

  afterEach(async () => {
    await source.stop();
    _resetClientFactoryForTests();
  });

  // -- Lifecycle --

  it('spawns a worker on start()', async () => {
    await source.start();
    expect(lastMockWorker).not.toBeNull();
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

  // -- pollNow --

  it('sends poll-now to the worker', async () => {
    await source.start();
    source.pollNow();
    const pollMsg = lastMockWorker!.postMessages.find(
      (m: any) => m.type === 'poll-now'
    );
    expect(pollMsg).toBeDefined();
  });

  // -- Notification insertion --

  it('inserts notifications into the DB when worker sends items', async () => {
    await source.start();
    const worker = lastMockWorker!;

    worker.emit('message', {
      type: 'notifications',
      items: [
        {
          source: 'slack',
          source_uid: 'slack-uid-1',
          sender_name: 'Alice',
          sender_email: 'alice@example.com',
          subject: '#general',
          body: 'Hey team',
          received_at: '2026-06-17T10:00:00Z',
          deep_link: 'https://app.slack.com/archives/C01/p1234',
          channel_id: 'C01234',
          thread_ts: null,
        },
      ],
      cursor: '2026-06-17T10:00:00Z',
    });

    expect(insertedNotifications).toHaveLength(1);
    expect((insertedNotifications[0] as any).source_uid).toBe('slack-uid-1');
    expect((insertedNotifications[0] as any).source).toBe('slack');
  });

  it('emits notification:new IPC event for inserted items', async () => {
    await source.start();
    lastMockWorker!.emit('message', {
      type: 'notifications',
      items: [
        {
          source: 'slack',
          source_uid: 'slack-uid-2',
          sender_name: 'Bob',
          sender_email: null,
          subject: 'DM with Bob',
          body: 'Quick question',
          received_at: '2026-06-17T11:00:00Z',
          deep_link: null,
          channel_id: null,
          thread_ts: null,
        },
      ],
      cursor: '2026-06-17T11:00:00Z',
    });

    expect(sendToAllWindows).toHaveBeenCalledWith('notification:new', expect.any(Object));
  });

  it('enqueues inserted notifications for classification', async () => {
    await source.start();
    lastMockWorker!.emit('message', {
      type: 'notifications',
      items: [
        {
          source: 'slack',
          source_uid: 'classify-uid',
          sender_name: 'Test',
          sender_email: null,
          subject: '#dev',
          body: 'Review needed',
          received_at: '2026-06-17T10:00:00Z',
          deep_link: null,
          channel_id: 'C999',
          thread_ts: null,
        },
      ],
      cursor: '2026-06-17T10:00:00Z',
    });

    expect(enqueueForClassification).toHaveBeenCalledWith('classify-uid');
  });

  // -- Cursor management --

  it('updates source_settings cursor after successful poll', async () => {
    await source.start();
    lastMockWorker!.emit('message', {
      type: 'notifications',
      items: [],
      cursor: '2026-06-17T12:00:00Z',
    });

    expect(settingsStore['slack']?.last_cursor_iso).toBe('2026-06-17T12:00:00Z');
  });

  it('writes last_poll_iso on every successful poll (including zero items)', async () => {
    settingsStore['slack'] = { last_error: 'Worker crashed repeatedly' };

    await source.start();
    const before = Date.now();
    lastMockWorker!.emit('message', {
      type: 'notifications',
      items: [],
      cursor: '2026-06-17T12:00:00Z',
    });

    const polled = settingsStore['slack']?.last_poll_iso;
    expect(polled).toBeTruthy();
    expect(new Date(polled as string).getTime()).toBeGreaterThanOrEqual(before - 100);
    expect(settingsStore['slack']?.last_error).toBeNull();
  });

  it('clears last_error on successful poll', async () => {
    settingsStore['slack'] = { last_error: 'previous error' };

    await source.start();
    lastMockWorker!.emit('message', {
      type: 'notifications',
      items: [],
      cursor: '2026-06-17T12:00:00Z',
    });

    expect(settingsStore['slack']?.last_error).toBeNull();
  });

  // -- Error handling --

  it('persists error to source_settings when worker sends error', async () => {
    await source.start();
    lastMockWorker!.emit('message', {
      type: 'error',
      error: 'Slack MCP connection failed',
    });

    expect(settingsStore['slack']?.last_error).toBe('Slack MCP connection failed');
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

    const realError = new Error("Cannot find module 'slack-mcp'");
    realError.stack = "Error: Cannot find module 'slack-mcp'\n    at Module._resolveFilename";

    const worker = lastMockWorker!;
    worker.emit('error', realError);
    worker.emit('exit', 1);

    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(11_000);
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

    const persisted = settingsStore['slack']?.last_error;
    expect(persisted).toBeTruthy();
    expect(persisted).toContain("Cannot find module 'slack-mcp'");
    expect(persisted).not.toBe('Worker crashed repeatedly');
  });

  // -- Cursor seeding --

  it('uses cursor from source_settings on init', async () => {
    settingsStore['slack'] = { last_cursor_iso: '2026-06-15T00:00:00Z' };

    await source.start();
    const initMsg = lastMockWorker!.postMessages.find(
      (m: any) => m.type === 'init'
    ) as any;
    expect(initMsg.cursor).toBe('2026-06-15T00:00:00Z');
  });

  it('sends null cursor when no settings exist', async () => {
    await source.start();
    const initMsg = lastMockWorker!.postMessages.find(
      (m: any) => m.type === 'init'
    ) as any;
    expect(initMsg.cursor).toBeNull();
  });

  // -- Log passthrough --

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

  // -- SDK round-trip (request-poll / sdk-response) --

  it('responds to request-poll by calling SDK and posting sdk-response', async () => {
    const session = makeSession('[{"source":"slack","source_uid":"a"}]');
    sdkState.session = session;
    sdkState.client = {
      createSession: vi.fn().mockResolvedValue(session),
    };
    _setClientFactory(() => sdkState.client as any);

    await source.start();
    lastMockWorker!.emit('message', {
      type: 'request-poll',
      id: 'req-1',
      prompt: 'List my Slack mentions',
    });

    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    expect(session.sendAndWait).toHaveBeenCalledWith(
      { prompt: 'List my Slack mentions' },
      expect.any(Number),
    );
    const responseMsg = lastMockWorker!.postMessages.find(
      (m: any) => m.type === 'sdk-response' && m.id === 'req-1'
    ) as any;
    expect(responseMsg).toBeDefined();
    expect(responseMsg.success).toBe(true);
    expect(responseMsg.text).toContain('slack');
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
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, 'slack-worker.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/from ['"]electron['"]/);
    expect(src).not.toMatch(/from ['"]\.\.\/ai['"]/);
    expect(src).not.toMatch(/@github\/copilot-sdk/);
  });

  // -- MCP wiring --

  it('passes the slack MCP server into createSession options', async () => {
    const session = makeSession('[]');
    const createSession = vi.fn().mockResolvedValue(session);
    sdkState.client = { createSession };
    _setClientFactory(() => sdkState.client as any);
    mcpServersStore.value = {
      slack: { type: 'stdio', command: 'slack-mcp' },
      workiq: { type: 'stdio', command: 'workiq-mcp' },
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
    expect(opts.mcpServers).toBeDefined();
    expect(opts.mcpServers).toHaveProperty('slack');
    expect(opts.mcpServers).not.toHaveProperty('workiq');
    expect(opts.mcpServers).not.toHaveProperty('datadog');
    expect(Object.keys(opts.mcpServers)).toEqual(['slack']);
  });

  it('omits mcpServers from createSession when no slack MCP is discovered', async () => {
    const session = makeSession('[]');
    const createSession = vi.fn().mockResolvedValue(session);
    sdkState.client = { createSession };
    _setClientFactory(() => sdkState.client as any);
    mcpServersStore.value = {
      workiq: { type: 'stdio', command: 'workiq-mcp' },
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

  it('passes the slack approval allowlist as onPermissionRequest', async () => {
    const session = makeSession('[]');
    const createSession = vi.fn().mockResolvedValue(session);
    sdkState.client = { createSession };
    _setClientFactory(() => sdkState.client as any);
    mcpServersStore.value = { slack: { type: 'stdio', command: 'slack-mcp' } };

    await source.start();
    lastMockWorker!.emit('message', { type: 'request-poll', id: 'r1', prompt: 'p' });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    const opts = createSession.mock.calls[0][0];
    expect(opts.onPermissionRequest).toBe(slackApprovalHandler);
  });

  // -- Follow-up on empty content with tool requests --

  it('issues a follow-up prompt when SDK returns empty content with toolRequests', async () => {
    const session = {
      sendAndWait: vi.fn()
        .mockResolvedValueOnce({ data: { content: '', toolRequests: [{ name: 'slack_search' }] } })
        .mockResolvedValueOnce({ data: { content: '[{"source":"slack","source_uid":"x"}]' } }),
      disconnect: vi.fn(),
    };
    sdkState.client = { createSession: vi.fn().mockResolvedValue(session) };
    _setClientFactory(() => sdkState.client as any);

    await source.start();
    lastMockWorker!.emit('message', {
      type: 'request-poll',
      id: 'req-followup',
      prompt: 'List my Slack mentions',
    });

    for (let i = 0; i < 10; i++) {
      await new Promise(r => setImmediate(r));
    }

    expect(session.sendAndWait).toHaveBeenCalledTimes(2);
    const followUpCall = session.sendAndWait.mock.calls[1];
    expect(followUpCall[0].prompt).toContain('JSON array');

    const responseMsg = lastMockWorker!.postMessages.find(
      (m: any) => m.type === 'sdk-response' && m.id === 'req-followup'
    ) as any;
    expect(responseMsg).toBeDefined();
    expect(responseMsg.success).toBe(true);
    expect(responseMsg.text).toContain('slack');
  });

  it('does not issue follow-up when content is non-empty', async () => {
    const session = makeSession('[{"source":"slack","source_uid":"a"}]');
    sdkState.client = { createSession: vi.fn().mockResolvedValue(session) };
    _setClientFactory(() => sdkState.client as any);

    await source.start();
    lastMockWorker!.emit('message', {
      type: 'request-poll',
      id: 'req-nofollow',
      prompt: 'List my Slack mentions',
    });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    expect(session.sendAndWait).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// slackApprovalHandler: standalone unit tests for the allowlist policy.
// ---------------------------------------------------------------------------

describe('slackApprovalHandler', () => {
  it('approves slack MCP tool calls', async () => {
    const result = await slackApprovalHandler({
      kind: 'mcp', serverName: 'slack', toolName: 'search', toolTitle: 'Search', readOnly: true,
    });
    expect(result.kind).toBe('approve-once');
  });

  it('rejects non-slack MCP tool calls', async () => {
    const result = await slackApprovalHandler({
      kind: 'mcp', serverName: 'workiq', toolName: 'fetch', toolTitle: 'Fetch', readOnly: true,
    });
    expect(result.kind).toBe('reject');
  });

  it('approves slack extension permission access (e.g. EULA)', async () => {
    const result = await slackApprovalHandler({
      kind: 'extension-permission-access', extensionName: 'slack', capabilities: ['eula'],
    });
    expect(result.kind).toBe('approve-once');
  });

  it('rejects non-slack extension permission access', async () => {
    const result = await slackApprovalHandler({
      kind: 'extension-permission-access', extensionName: 'workiq', capabilities: ['eula'],
    });
    expect(result.kind).toBe('reject');
  });

  it('approves slack extension management', async () => {
    const result = await slackApprovalHandler({
      kind: 'extension-management', extensionName: 'slack', operation: 'reload',
    });
    expect(result.kind).toBe('approve-once');
  });

  it('approves harmless reads', async () => {
    const result = await slackApprovalHandler({ kind: 'read' });
    expect(result.kind).toBe('approve-once');
  });

  it('rejects shell, write, url, memory, custom-tool, hook', async () => {
    for (const kind of ['shell', 'write', 'url', 'memory', 'custom-tool', 'hook']) {
      const result = await slackApprovalHandler({ kind });
      expect(result.kind, kind).toBe('reject');
    }
  });
});
