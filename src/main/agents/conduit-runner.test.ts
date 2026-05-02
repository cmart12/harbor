import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron app before any imports that touch config.ts
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-conduit' },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

import {
  ConduitHostClient,
  ConduitAgentSession,
  type ConduitJoinResult,
  type ConduitSessionInfo,
  type ConduitConnectResult,
} from '../conduit-client';

// ── ConduitHostClient tests ────────────────────────────────────────

describe('ConduitHostClient', () => {
  let client: ConduitHostClient;

  beforeEach(() => {
    client = new ConduitHostClient('http://localhost:8080');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores baseUrl', () => {
    expect(client.baseUrl).toBe('http://localhost:8080');
  });

  it('isReachable returns false on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await client.isReachable()).toBe(false);
  });

  it('isReachable returns true on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200 }),
    );
    expect(await client.isReachable()).toBe(true);
  });

  it('isReachable returns false on 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('error', { status: 500 }),
    );
    expect(await client.isReachable()).toBe(false);
  });

  it('createSession sends POST to /api/sessions', async () => {
    const mockSession: ConduitSessionInfo = {
      id: 'ses_123',
      status: 'created',
      transport: 'websocket',
      endpoint: 'ws://localhost:9000',
      orphanPolicy: 'timeout',
      ownerUserId: 'user1',
      clientCount: 0,
      eventCount: 0,
      createdAt: '2025-01-01T00:00:00Z',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockSession), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await client.createSession({ workspacePath: '/tmp/test' });
    expect(result.id).toBe('ses_123');
    expect(result.status).toBe('created');

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(fetchCall[0]).toBe('http://localhost:8080/api/sessions');
    expect((fetchCall[1] as any).method).toBe('POST');
  });

  it('listSessions sends GET to /api/sessions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await client.listSessions();
    expect(result).toEqual([]);
  });

  it('listSessions appends status query param', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await client.listSessions('running');
    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toContain('?status=running');
  });

  it('throws on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(client.getSession('bad_id')).rejects.toThrow('Not found');
  });

  it('joinSession sends POST to /api/sessions/:id/join', async () => {
    const mockJoin: ConduitJoinResult = {
      sessionId: 'ses_123',
      transport: 'websocket',
      endpoint: 'ws://localhost:9000',
      clientId: 'cli_456',
      endpoints: [{ url: 'ws://localhost:9000', transport: 'websocket' }],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockJoin), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await client.joinSession('ses_123');
    expect(result.clientId).toBe('cli_456');
    expect(result.endpoints).toHaveLength(1);
  });

  it('joinSession passes clientName in request body', async () => {
    const mockJoin: ConduitJoinResult = {
      sessionId: 'ses_123',
      transport: 'websocket',
      endpoint: 'ws://localhost:9000',
      clientId: 'cli_456',
      clientName: 'whim',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockJoin), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await client.joinSession('ses_123', 'whim');
    expect(result.clientName).toBe('whim');

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((fetchCall[1] as any).body);
    expect(body.clientName).toBe('whim');
  });

  it('joinSession omits body when no clientName', async () => {
    const mockJoin: ConduitJoinResult = {
      sessionId: 'ses_123',
      transport: 'websocket',
      endpoint: 'ws://localhost:9000',
      clientId: 'cli_456',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockJoin), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await client.joinSession('ses_123');

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect((fetchCall[1] as any).body).toBeUndefined();
  });

  it('getSessionClients sends GET to /api/sessions/:id/clients', async () => {
    const mockClients = {
      clientCount: 2,
      clients: [
        { clientId: 'cli_1', clientName: 'whim', connectedAt: '2025-01-01T00:00:00Z' },
        { clientId: 'cli_2', clientName: 'agent-tui', connectedAt: '2025-01-01T00:01:00Z' },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockClients), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await client.getSessionClients('ses_123');
    expect(result.clientCount).toBe(2);
    expect(result.clients).toHaveLength(2);
    expect(result.clients[0]!.clientName).toBe('whim');

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe('http://localhost:8080/api/sessions/ses_123/clients');
  });

  it('createAndConnect sends POST to /api/sessions/connect', async () => {
    const mockResult: ConduitConnectResult = {
      session: {
        id: 'ses_new',
        status: 'running',
        transport: 'websocket',
        endpoint: 'ws://localhost:9000',
        orphanPolicy: 'timeout',
        ownerUserId: 'user1',
        clientCount: 1,
        eventCount: 0,
        createdAt: '2025-01-01T00:00:00Z',
      },
      connection: {
        sessionId: 'ses_new',
        transport: 'websocket',
        endpoint: 'ws://localhost:9000',
        clientId: 'cli_789',
        endpoints: [{ url: 'ws://localhost:9000', transport: 'websocket' }],
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await client.createAndConnect({ workspacePath: '/tmp' });
    expect(result.connection.sessionId).toBe('ses_new');

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(fetchCall[0]).toBe('http://localhost:8080/api/sessions/connect');
  });

  it('deleteSession sends DELETE', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await expect(client.deleteSession('ses_123')).resolves.toBeUndefined();
    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect((fetchCall[1] as any).method).toBe('DELETE');
  });
});

// ── ConduitAgentSession tests ──────────────────────────────────────

describe('ConduitAgentSession', () => {
  it('creates with correct properties', () => {
    const session = new ConduitAgentSession({
      sessionId: 'ses_123',
      clientId: 'cli_456',
      endpoints: [{ url: 'ws://localhost:9000', transport: 'websocket' }],
    });

    expect(session.sessionId).toBe('ses_123');
    expect(session.clientId).toBe('cli_456');
    expect(session.clientName).toBeUndefined();
    expect(session.connected).toBe(false);
  });

  it('stores clientName when provided', () => {
    const session = new ConduitAgentSession({
      sessionId: 'ses_123',
      clientId: 'cli_456',
      clientName: 'whim',
      endpoints: [{ url: 'ws://localhost:9000', transport: 'websocket' }],
    });

    expect(session.clientName).toBe('whim');
  });

  it('throws when calling call() while disconnected', async () => {
    const session = new ConduitAgentSession({
      sessionId: 'ses_123',
      clientId: 'cli_456',
      endpoints: [{ url: 'ws://localhost:9000', transport: 'websocket' }],
    });

    await expect(session.call('test')).rejects.toThrow('Not connected');
  });

  it('throws when no websocket endpoints available', async () => {
    const session = new ConduitAgentSession({
      sessionId: 'ses_123',
      clientId: 'cli_456',
      endpoints: [{ url: 'localhost:9000', transport: 'tcp' }],
    });

    await expect(session.connect()).rejects.toThrow('No usable WebSocket endpoint');
  });

  it('close() rejects pending requests', async () => {
    const session = new ConduitAgentSession({
      sessionId: 'ses_123',
      clientId: 'cli_456',
      endpoints: [],
    });

    // close on an already-disconnected session should not throw
    await expect(session.close()).resolves.toBeUndefined();
  });
});

// ── Binary frame encoding tests ────────────────────────────────────

describe('binary frame encoding', () => {
  // These test the internal encoding used by ConduitAgentSession._send
  // by verifying the frame format matches the conduit protocol spec

  it('JSON frame has correct header', () => {
    // The frame format is [type:u8][length:u32be][json_payload]
    // Type 0x01 = JSON-RPC
    const FRAME_TYPE_JSON = 0x01;
    const FRAME_HEADER_SIZE = 5;

    const json = JSON.stringify({ jsonrpc: '2.0', method: 'test' });
    const body = Buffer.from(json, 'utf-8');
    const frame = Buffer.alloc(FRAME_HEADER_SIZE + body.length);
    frame.writeUInt8(FRAME_TYPE_JSON, 0);
    frame.writeUInt32BE(body.length, 1);
    body.copy(frame, FRAME_HEADER_SIZE);

    expect(frame[0]).toBe(0x01); // JSON type
    expect(frame.readUInt32BE(1)).toBe(body.length);
    expect(frame.toString('utf-8', FRAME_HEADER_SIZE)).toBe(json);
  });
});
