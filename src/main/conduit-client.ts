/**
 * Lightweight Conduit client for the Intent app.
 *
 * Speaks the Conduit HTTP REST API (host) and binary-framed JSON-RPC
 * (session) without depending on @conduit/client-sdk or its monorepo
 * workspace packages.
 */
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { getConfigValue } from './config';

// ── Binary frame codec (matches @conduit/protocol) ─────────────────

const FRAME_TYPE_JSON = 0x01;
const FRAME_HEADER_SIZE = 5;

function encodeJsonFrame(value: unknown): Buffer {
  const json = JSON.stringify(value);
  const body = Buffer.from(json, 'utf-8');
  const frame = Buffer.alloc(FRAME_HEADER_SIZE + body.length);
  frame.writeUInt8(FRAME_TYPE_JSON, 0);
  frame.writeUInt32BE(body.length, 1);
  body.copy(frame, FRAME_HEADER_SIZE);
  return frame;
}

// ── JSON-RPC helpers ───────────────────────────────────────────────

function jsonRpcRequest(id: number, method: string, params?: unknown): object {
  return { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
}

function jsonRpcNotification(method: string, params?: unknown): object {
  return { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
}

// ── Types (mirrors essential @conduit/client-sdk types) ────────────

export type ConduitTransport = 'tcp' | 'uds' | 'websocket' | 'named_pipe';
export type ConduitSessionStatus = 'created' | 'running' | 'suspended';
export type ConduitSessionActivity = 'idle' | 'processing' | 'awaiting_permission' | 'awaiting_input' | 'error';
export type ConduitOrphanPolicy = 'timeout' | 'immediate' | 'keep_alive';

export interface ConduitEndpointInfo {
  url: string;
  transport: ConduitTransport;
}

export interface ConduitSessionInfo {
  id: string;
  status: ConduitSessionStatus | string;
  activity?: ConduitSessionActivity;
  transport: ConduitTransport;
  endpoint: string;
  orphanPolicy: ConduitOrphanPolicy;
  ownerUserId: string;
  clientCount: number;
  eventCount: number;
  createdAt: string;
  compute?: string;
  workspace?: string;
  workspacePath?: string;
  summary?: string;
  updatedAt?: string;
  cwd?: string;
  repository?: string;
  branch?: string;
  hostId?: string;
}

export interface ConduitJoinResult {
  sessionId: string;
  transport: ConduitTransport;
  endpoint: string;
  clientId: string;
  endpoints?: ConduitEndpointInfo[];
}

export interface ConduitConnectResult {
  session: ConduitSessionInfo;
  connection: ConduitJoinResult;
}

export interface ConduitCreateSessionRequest {
  transport?: ConduitTransport;
  config?: string;
  orphanPolicy?: ConduitOrphanPolicy;
  orphanTimeoutSeconds?: number;
  workspace?: string;
  workspacePath?: string;
  settings?: Record<string, unknown>;
  profile?: string;
  provider?: string;
  compute?: string;
  command?: string;
  token?: string;
}

// Agent service types
export interface AgentSubmitParams {
  message?: string;
  prompt?: string;
  nonce?: string;
  attachments?: Array<{ type: string; [key: string]: unknown }>;
}

export interface AgentPermissionResponseParams {
  requestId: string;
  result: 'allow' | 'deny' | 'allow-session';
  feedback?: string;
}

export interface AgentUserInputResponseParams {
  requestId: string;
  answer: string;
  wasFreeform?: boolean;
}

// ── ConduitHostClient ──────────────────────────────────────────────

export class ConduitHostClient {
  constructor(readonly baseUrl: string) {}

  async isReachable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/sessions`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async createSession(req: ConduitCreateSessionRequest): Promise<ConduitSessionInfo> {
    return this._request<ConduitSessionInfo>('POST', '/api/sessions', req);
  }

  async listSessions(status?: string): Promise<ConduitSessionInfo[]> {
    const query = status ? `?status=${status}` : '';
    return this._request<ConduitSessionInfo[]>('GET', `/api/sessions${query}`);
  }

  async getSession(id: string): Promise<ConduitSessionInfo> {
    return this._request<ConduitSessionInfo>('GET', `/api/sessions/${id}`);
  }

  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE session failed: ${res.status} ${res.statusText}`);
  }

  async startSession(id: string, compute?: string): Promise<ConduitSessionInfo> {
    return this._request<ConduitSessionInfo>('POST', `/api/sessions/${id}/start`, compute ? { compute } : undefined);
  }

  async suspendSession(id: string): Promise<ConduitSessionInfo> {
    return this._request<ConduitSessionInfo>('POST', `/api/sessions/${id}/suspend`);
  }

  async joinSession(id: string): Promise<ConduitJoinResult> {
    return this._request<ConduitJoinResult>('POST', `/api/sessions/${id}/join`);
  }

  async connectSession(id: string, opts?: { profile?: string; compute?: string; settings?: Record<string, unknown> }): Promise<ConduitConnectResult> {
    return this._request<ConduitConnectResult>('POST', `/api/sessions/${id}/connect`, opts);
  }

  async createAndConnect(req: ConduitCreateSessionRequest): Promise<ConduitConnectResult> {
    return this._request<ConduitConnectResult>('POST', '/api/sessions/connect', req);
  }

  private async _request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {};
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const errBody = (await res.json()) as { error?: string };
        if (errBody.error) msg = errBody.error;
      } catch { /* ignore */ }
      throw new Error(`Conduit API error (${method} ${path}): ${msg}`);
    }
    return (await res.json()) as T;
  }
}

// ── ConduitAgentSession ────────────────────────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  method: string;
}

/**
 * A connected Conduit session that speaks JSON-RPC over WebSocket.
 * Provides agent.* RPC methods and event notifications.
 */
export class ConduitAgentSession extends EventEmitter {
  readonly sessionId: string;
  readonly clientId: string;
  private _ws: WebSocket | null = null;
  private _connected = false;
  private _nextId = 1;
  private _pending = new Map<number, PendingRequest>();
  private _endpoints: ConduitEndpointInfo[];

  constructor(opts: {
    sessionId: string;
    clientId: string;
    endpoints: ConduitEndpointInfo[];
  }) {
    super();
    this.sessionId = opts.sessionId;
    this.clientId = opts.clientId;
    this._endpoints = opts.endpoints;
  }

  get connected(): boolean { return this._connected; }

  /** Connect to the session, trying WebSocket endpoints first. */
  async connect(): Promise<void> {
    // Prefer websocket endpoints
    const wsEndpoints = this._endpoints.filter(e => e.transport === 'websocket');
    const others = this._endpoints.filter(e => e.transport !== 'websocket');
    const ordered = [...wsEndpoints, ...others];

    for (let i = 0; i < ordered.length; i++) {
      const ep = ordered[i]!;
      if (ep.transport !== 'websocket') {
        // Only WebSocket supported in this lightweight client
        continue;
      }
      try {
        await this._connectWebSocket(ep.url);
        // Subscribe to events from current position forward
        await this.notify('events.subscribe', { since: Number.MAX_SAFE_INTEGER });
        return;
      } catch (err) {
        if (i >= ordered.length - 1) throw err;
      }
    }
    throw new Error('No usable WebSocket endpoint found');
  }

  /** Default RPC call timeout (60s). */
  private static RPC_TIMEOUT_MS = 60_000;
  /** WebSocket connect timeout (10s). */
  private static CONNECT_TIMEOUT_MS = 10_000;

  /** Send a JSON-RPC request and wait for the response. */
  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this._nextId++;
    const request = jsonRpcRequest(id, method, params);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`RPC timeout: ${method} (${ConduitAgentSession.RPC_TIMEOUT_MS}ms)`));
      }, ConduitAgentSession.RPC_TIMEOUT_MS);

      this._pending.set(id, {
        resolve: (v: unknown) => { clearTimeout(timer); resolve(v as T); },
        reject: (r: unknown) => { clearTimeout(timer); reject(r); },
        method,
      });
      try {
        this._send(request);
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  /** Send a JSON-RPC notification (no response expected). */
  async notify(method: string, params?: unknown): Promise<void> {
    this._send(jsonRpcNotification(method, params));
  }

  // ─── Agent RPC methods ─────────────────────────────────────────

  async agentSubmit(params: AgentSubmitParams): Promise<{ status: string }> {
    return this.call('agent.submit', params);
  }

  async agentSubmitSync(params: AgentSubmitParams): Promise<{ status: string; content: string }> {
    return this.call('agent.submit_sync', params);
  }

  async agentAbort(): Promise<{ status: string }> {
    return this.call('agent.abort');
  }

  async agentCancel(): Promise<{ status: string }> {
    return this.call('agent.cancel');
  }

  async agentStatus(): Promise<{ initialized: boolean; status: string }> {
    return this.call('agent.status');
  }

  async agentHistory(): Promise<{ messages: Array<{ index: number; type: string; ts: string; data?: Record<string, unknown> }> }> {
    return this.call('agent.history');
  }

  async agentPermissionResponse(params: AgentPermissionResponseParams): Promise<void> {
    await this.call('agent.permission_response', params);
  }

  async agentUserInputResponse(params: AgentUserInputResponseParams): Promise<void> {
    await this.call('agent.user_input_response', params);
  }

  /** Close the connection. */
  async close(): Promise<void> {
    this._connected = false;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    for (const [, pending] of this._pending) {
      pending.reject(new Error('Connection closed'));
    }
    this._pending.clear();
  }

  // ─── Private ───────────────────────────────────────────────────

  private _send(msg: object): void {
    if (!this._ws || !this._connected) {
      throw new Error('Not connected to conduit session');
    }
    this._ws.send(encodeJsonFrame(msg));
  }

  private _connectWebSocket(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = 'nodebuffer';

      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`WebSocket connect timeout (${ConduitAgentSession.CONNECT_TIMEOUT_MS}ms)`));
      }, ConduitAgentSession.CONNECT_TIMEOUT_MS);

      ws.on('open', () => {
        clearTimeout(timer);
        this._ws = ws;
        this._connected = true;
        resolve();
      });

      ws.on('message', (data: Buffer | string) => {
        this._handleRawMessage(data);
      });

      ws.on('close', () => {
        const wasConnected = this._connected;
        this._connected = false;
        this._ws = null;
        for (const [, pending] of this._pending) {
          pending.reject(new Error('Connection closed'));
        }
        this._pending.clear();
        if (wasConnected) {
          this.emit('disconnected');
        }
      });

      ws.on('error', (err) => {
        if (!this._connected) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  private _handleRawMessage(data: Buffer | string): void {
    let jsonStr: string;
    if (typeof data === 'string') {
      jsonStr = data;
    } else if (data instanceof Buffer) {
      // Could be binary-framed or raw JSON
      if (data.length > 0 && data[0] === 0x7b) {
        // Raw JSON (starts with '{')
        jsonStr = data.toString('utf-8');
      } else if (data.length >= FRAME_HEADER_SIZE) {
        // Binary frame: [type:u8][length:u32be][payload]
        const frameType = data.readUInt8(0);
        if (frameType === FRAME_TYPE_JSON) {
          const payloadLen = data.readUInt32BE(1);
          if (payloadLen > data.length - FRAME_HEADER_SIZE) {
            // Truncated frame — ignore
            return;
          }
          jsonStr = data.toString('utf-8', FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + payloadLen);
        } else {
          // Terminal or other frame type — ignore for now
          return;
        }
      } else {
        return;
      }
    } else {
      return;
    }

    // Handle multiple messages in a single frame (newline-separated)
    const lines = jsonStr.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this._handleJsonMessage(trimmed);
    }
  }

  private _handleJsonMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    // Server notification (no id)
    if (msg.id === undefined || msg.id === null) {
      if (msg.method) {
        this.emit('notification', msg.method, msg.params);
        // Also emit typed event: 'agent.task_completed' → emit('agent.task_completed', params)
        this.emit(msg.method, msg.params);
      }
      return;
    }

    // Response to a pending request
    const pending = this._pending.get(msg.id);
    if (!pending) return;
    this._pending.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(`${msg.error.message} (code: ${msg.error.code})`));
    } else {
      pending.resolve(msg.result);
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let hostClient: ConduitHostClient | null = null;

/**
 * Get or create a ConduitHostClient for the configured host URL.
 * Returns null if no conduit host URL is configured.
 */
export function getConduitHostClient(): ConduitHostClient | null {
  const url = getConfigValue('conduitHostUrl');
  if (!url) return null;

  if (!hostClient || hostClient.baseUrl !== url) {
    hostClient = new ConduitHostClient(url);
  }
  return hostClient;
}

/**
 * Create a connected ConduitAgentSession from a JoinResult.
 */
export async function connectConduitSession(
  joinResult: ConduitJoinResult,
): Promise<ConduitAgentSession> {
  const endpoints = joinResult.endpoints ?? [{
    url: joinResult.endpoint,
    transport: joinResult.transport,
  }];

  const session = new ConduitAgentSession({
    sessionId: joinResult.sessionId,
    clientId: joinResult.clientId,
    endpoints,
  });
  await session.connect();
  return session;
}
