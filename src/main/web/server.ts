import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import type { Duplex } from 'stream';
import * as QRCode from 'qrcode';
import { WebSocket, WebSocketServer } from 'ws';
import type { WebRemoteState } from '../../shared/ipc-contract';
import {
  defaultWebRemoteBindAddresses,
  ensureWebRemoteToken,
  getConfig,
  getConfigValue,
  listWebRemoteInterfaces,
  normalizeWebRemoteBindAddresses,
  normalizeWebRemotePort,
} from '../config';
import {
  extractHttpToken,
  extractWebSocketProtocolToken,
  getRemoteAddress,
  WebRemoteAuthenticator,
} from './auth';
import { GatewayError, invokeWebRemoteCommand } from './gateway';
import { subscribeWebRemoteEvents } from './event-hub';

interface Binding {
  address: string;
  server: http.Server;
  wss: WebSocketServer;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const MAX_BODY_BYTES = 1_000_000;
const clients = new Set<WebSocket>();
let bindings: Binding[] = [];
let lastError: string | null = null;

const authenticator = new WebRemoteAuthenticator(() => getConfigValue('webRemoteToken'));

export async function syncWebRemoteServer(): Promise<WebRemoteState> {
  if (getConfigValue('webRemoteEnabled')) {
    try {
      await startWebRemoteServer();
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn('[web-remote] Failed to start:', lastError);
      await stopWebRemoteServer();
    }
  } else {
    await stopWebRemoteServer();
  }
  return getWebRemoteState();
}

export async function restartWebRemoteServer(): Promise<WebRemoteState> {
  await stopWebRemoteServer();
  return syncWebRemoteServer();
}

export async function startWebRemoteServer(): Promise<void> {
  await stopWebRemoteServer();

  const workspace = getConfigValue('workspace');
  if (!workspace) {
    throw new Error('Select a workspace before enabling web remote access.');
  }

  const token = ensureWebRemoteToken();
  if (!token) {
    throw new Error('Web remote token is not configured.');
  }

  const config = getConfig();
  const port = normalizeWebRemotePort(config.webRemotePort);
  const addresses = normalizeWebRemoteBindAddresses(config.webRemoteBindAddresses);
  const bindAddresses = addresses.length > 0 ? addresses : defaultWebRemoteBindAddresses();
  const errors: string[] = [];

  for (const address of bindAddresses) {
    try {
      bindings.push(await startBinding(address, port, bindAddresses));
    } catch (err) {
      errors.push(`${address}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (bindings.length === 0) {
    throw new Error(errors.length ? errors.join('; ') : 'No bind addresses are available.');
  }

  lastError = errors.length ? errors.join('; ') : null;
}

export async function stopWebRemoteServer(): Promise<void> {
  authenticator.reset();
  for (const client of clients) {
    client.terminate();
  }
  clients.clear();

  const closing = bindings.map(({ server, wss }) => new Promise<void>((resolve) => {
    wss.close(() => {
      server.close(() => resolve());
    });
  }));
  bindings = [];
  await Promise.all(closing);
}

export async function getWebRemoteState(): Promise<WebRemoteState> {
  const config = getConfig();
  const token = ensureWebRemoteToken();
  const bindAddresses = config.webRemoteBindAddresses.length > 0
    ? config.webRemoteBindAddresses
    : defaultWebRemoteBindAddresses();
  const urls = buildRemoteUrls(bindAddresses, config.webRemotePort, token);
  const qrUrl = urls.find((url) => !url.includes('127.0.0.1') && !url.includes('[::1]')) ?? urls[0] ?? null;

  let qrDataUrl: string | null = null;
  if (qrUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 192 });
    } catch (err) {
      console.warn('[web-remote] Failed to render QR code:', err);
    }
  }

  return {
    enabled: config.webRemoteEnabled,
    running: bindings.length > 0,
    port: config.webRemotePort,
    token,
    bindAddresses,
    interfaces: listWebRemoteInterfaces(),
    urls,
    qrDataUrl,
    error: lastError,
  };
}

function startBinding(address: string, port: number, allowedHosts: string[]): Promise<Binding> {
  const wss = new WebSocketServer({ noServer: true });
  const server = http.createServer((req, res) => {
    void handleHttp(req, res, allowedHosts).catch((err) => {
      const status = err instanceof GatewayError ? err.status : 500;
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendJson(res, status, { ok: false, error: { code: 'request_failed', message } });
    });
  });

  server.on('upgrade', (req, socket, head) => {
    void handleUpgrade(req, socket, head, wss, allowedHosts);
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'hello', timestamp: new Date().toISOString() }));
    const unsubscribe = subscribeWebRemoteEvents((event) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'event', event }));
      }
    });
    ws.on('close', () => {
      unsubscribe();
      clients.delete(ws);
    });
    ws.on('error', () => {
      unsubscribe();
      clients.delete(ws);
    });
  });

  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      server.on('error', (err) => console.warn('[web-remote] Server error:', err));
      resolve({ address, server, wss });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, address);
  });
}

async function handleHttp(req: http.IncomingMessage, res: http.ServerResponse, allowedHosts: string[]): Promise<void> {
  const url = requestUrl(req);
  if (!isAllowedHost(req.headers.host, allowedHosts)) {
    sendJson(res, 403, { ok: false, error: { code: 'host_not_allowed', message: 'Host header is not allowed.' } });
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const auth = authenticator.authenticate(extractHttpToken(req.headers, url), getRemoteAddress(req));
    if (!auth.ok) {
      sendJson(res, auth.status, { ok: false, error: { code: 'auth_failed', message: auth.message } });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, result: { running: true } });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/invoke') {
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new GatewayError('invalid_body', 400, 'Request body must be an object.');
      }
      const payload = body as Record<string, unknown>;
      if (typeof payload.channel !== 'string') {
        throw new GatewayError('invalid_body', 400, 'channel must be a string.');
      }
      const result = await invokeWebRemoteCommand(payload.channel, Array.isArray(payload.args) ? payload.args : []);
      sendJson(res, 200, { ok: true, result });
      return;
    }

    sendJson(res, 404, { ok: false, error: { code: 'not_found', message: 'API endpoint not found.' } });
    return;
  }

  serveStatic(req, res, url);
}

async function handleUpgrade(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  wss: WebSocketServer,
  allowedHosts: string[],
): Promise<void> {
  const url = requestUrl(req);
  if (url.pathname !== '/api/events' || !isAllowedHost(req.headers.host, allowedHosts)) {
    socket.destroy();
    return;
  }

  const token = extractHttpToken(req.headers, url) ?? extractWebSocketProtocolToken(req.headers['sec-websocket-protocol']);
  const auth = authenticator.authenticate(token, getRemoteAddress(req));
  if (!auth.ok) {
    socket.write(`HTTP/1.1 ${auth.status} ${auth.message}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new GatewayError('body_too_large', 413, 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new GatewayError('invalid_json', 400, 'Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  const root = path.resolve(__dirname, '..', '..', 'web');
  const decodedPath = decodeURIComponent(url.pathname);
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const resolved = path.resolve(root, relativePath);

  if (!resolved.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const filePath = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? path.join(resolved, 'index.html')
    : resolved;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function requestUrl(req: http.IncomingMessage): URL {
  return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
}

function buildRemoteUrls(bindAddresses: string[], port: number, token: string): string[] {
  return bindAddresses.map((address) => {
    const host = address.includes(':') ? `[${address}]` : address;
    return `http://${host}:${port}/?token=${encodeURIComponent(token)}`;
  });
}

function isAllowedHost(hostHeader: string | undefined, bindAddresses: string[]): boolean {
  if (!hostHeader) return true;
  const host = parseHostHeader(hostHeader);
  const hostname = os.hostname().toLowerCase();
  const shortHostname = hostname.split('.')[0];
  const allowed = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    hostname,
    shortHostname,
    `${shortHostname}.local`,
    ...bindAddresses.map((address) => address.toLowerCase()),
  ]);

  if (allowed.has(host)) return true;
  if (host.endsWith('.ts.net')) return true;
  return net.isIP(host) !== 0 && bindAddresses.includes(host);
}

function parseHostHeader(hostHeader: string): string {
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end > 0 ? trimmed.slice(1, end) : trimmed;
  }
  return trimmed.split(':')[0];
}
