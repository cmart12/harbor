/**
 * Centralized main-process logger (Phase C prep).
 *
 * Uses `electron-log` under the hood with a single file transport at
 * the debug-tap path: ~/.copilot/sessions-output/harbor-debug.log
 *   - Truncated on every app launch for a fresh, self-contained log.
 *   - Well-known path the parent agent can `tail -f`.
 *
 * Call `initMainLog()` once from `main.ts` before spawning any workers.
 * Then import `mainLog` anywhere in the main process.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { app, ipcMain } from 'electron';

export const DEBUG_LOG_DIR = path.join(os.homedir(), '.copilot', 'sessions-output');
export const DEBUG_LOG_PATH = path.join(DEBUG_LOG_DIR, 'harbor-debug.log');

export interface MainLog {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

let _log: MainLog | null = null;

/**
 * Initialize the dual-transport logger. Idempotent.
 */
export function initMainLog(): void {
  if (_log) return;

  // Ensure debug log directory exists (mkdir -p semantics).
  fs.mkdirSync(DEBUG_LOG_DIR, { recursive: true });

  // Truncate the debug log so each Harbor launch produces a fresh file.
  fs.writeFileSync(DEBUG_LOG_PATH, '');

  try {
    // electron-log v5 exposes `electron-log/main` for the main process.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('electron-log/main');
    const log = mod?.default ?? mod;

    // Single file transport: debug-tap path is the source of truth.
    log.transports.file.level = 'info';
    log.transports.file.resolvePathFn = () => DEBUG_LOG_PATH;

    // Console transport: only in dev.
    if (log.transports.console) {
      log.transports.console.level = app.isPackaged ? false : 'info';
    }

    _log = {
      info: (...args: unknown[]) => log.info(...args),
      warn: (...args: unknown[]) => log.warn(...args),
      error: (...args: unknown[]) => log.error(...args),
    };
  } catch (err: unknown) {
    // Fallback: if electron-log fails to load (e.g. test environment),
    // use a simple fs-append logger so the debug file still works.
    const fallback = makeFallbackLog();
    _log = fallback;
    fallback.warn('[main-log] electron-log unavailable, using fallback:', err);
  }

  // Register IPC channel so the renderer can forward logs to the
  // main-process file sink. Fire-and-forget (ipcMain.on, not .handle).
  ipcMain.on('log:from-renderer', (_event, payload: { level: string; message: string }) => {
    const log = _log;
    if (!log) return;
    const lvl = payload?.level;
    const msg = typeof payload?.message === 'string' ? payload.message : String(payload?.message);
    if (lvl === 'error') log.error(msg);
    else if (lvl === 'warn') log.warn(msg);
    else log.info(msg);
  });
}

function makeFallbackLog(): MainLog {
  const write = (level: string, args: unknown[]) => {
    const ts = new Date().toISOString();
    const msg = args.map(safeStringifyArg).join(' ');
    const line = `[${ts}] [${level}] ${msg}\n`;
    try {
      fs.appendFileSync(DEBUG_LOG_PATH, line);
    } catch {
      // Best-effort.
    }
    // Also write to stdout for dev visibility.
    if (level === 'error') console.error(line.trimEnd());
    else if (level === 'warn') console.warn(line.trimEnd());
    else console.log(line.trimEnd());
  };
  return {
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
  };
}

function safeStringifyArg(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * The main-process logger. Throws if `initMainLog()` has not been called.
 */
export function getMainLog(): MainLog {
  if (!_log) {
    throw new Error('[main-log] initMainLog() must be called before getMainLog()');
  }
  return _log;
}

/**
 * Convenience re-export: a getter that lazily resolves on first access.
 * Safe to import at module level; will throw at call-time if init is missing.
 */
export const mainLog: MainLog = new Proxy({} as MainLog, {
  get(_target, prop: string) {
    const log = getMainLog();
    return (log as unknown as Record<string, unknown>)[prop];
  },
});

/**
 * Emit the startup banner. Call right after `initMainLog()`.
 */
export function logStartupBanner(): void {
  const log = getMainLog();
  const version = app.getVersion();
  const ts = new Date().toISOString();
  // Build sha is embedded by CI; fall back to 'dev' for local builds.
  const sha = process.env.HARBOR_BUILD_SHA?.slice(0, 7) ?? 'dev';
  log.info(`=== Harbor session started ${ts}, build sha=${sha}, Harbor version=${version} ===`);
}

/**
 * Serialize a value for safe transport across worker boundaries.
 * Tolerates circular refs, Errors, and undefined.
 */
export function safeStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    return JSON.stringify({ name: value.name, message: value.message, stack: value.stack });
  }
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    });
  } catch {
    return String(value);
  }
}
