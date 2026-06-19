/**
 * Centralized main-process logger.
 *
 * Writes via `fs.appendFileSync` to the debug-tap path:
 *   ~/.copilot/sessions-output/harbor-debug.log
 *
 * Behavior:
 *   - File is truncated on every app launch for a fresh, self-contained log
 *   - Subsequent writes append; every write opens, writes, closes (no buffering)
 *   - Well-known path the parent agent can `tail -f`
 *
 * History: previously delegated to `electron-log` v5, which silently failed
 * to honor `transports.file.resolvePathFn` in packaged builds. After
 * `fs.writeFileSync(path, '')` truncated the file, electron-log either
 * cached a stale file handle or routed to its default userData path,
 * resulting in only the startup banner reaching the debug tap. Switching
 * to direct `fs.appendFileSync` eliminates the indirection.
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
 * Initialize the file-append logger. Idempotent.
 */
export function initMainLog(): void {
  if (_log) return;

  fs.mkdirSync(DEBUG_LOG_DIR, { recursive: true });

  try {
    fs.writeFileSync(DEBUG_LOG_PATH, '');
  } catch {
    // Best-effort truncate. Continue even if it fails.
  }

  _log = makeFileLog();

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

function makeFileLog(): MainLog {
  const write = (level: string, args: unknown[]) => {
    const ts = new Date().toISOString();
    const msg = args.map(safeStringifyArg).join(' ');
    const line = `[${ts}] [${level}] ${msg}\n`;
    try {
      fs.appendFileSync(DEBUG_LOG_PATH, line);
    } catch {
      // Best-effort.
    }
    // Also mirror to stdout for dev visibility (only when running from terminal).
    if (!app.isPackaged) {
      if (level === 'error') console.error(line.trimEnd());
      else if (level === 'warn') console.warn(line.trimEnd());
      else console.log(line.trimEnd());
    }
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
