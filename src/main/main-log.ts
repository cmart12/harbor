/**
 * Main-process file logger (Phase C.1 hotfix #2).
 *
 * Thin wrapper around electron-log that writes to `<userData>/logs/main.log`.
 * Lets the main process capture errors that would otherwise vanish (no
 * stdout in packaged builds, DevTools is renderer-side only).
 *
 * Intentionally minimal: only `info` / `warn` / `error` for now. Initialized
 * once at app-ready from `main.ts`. Modules that need to log import the
 * `mainLog` proxy below; if `initMainLog()` was never called they fall
 * back to `console`.
 */

import * as path from 'path';
import { app } from 'electron';

type LogFn = (...args: unknown[]) => void;
interface MainLog {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

let configured: MainLog | null = null;

const consoleFallback: MainLog = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

/**
 * Configure electron-log to write to `<userData>/logs/main.log`. Idempotent.
 * Safe to call at app-ready. Falls back to console on failure.
 */
export function initMainLog(): void {
  if (configured) return;
  try {
    const mod = require('electron-log/main');
    const log = mod?.default ?? mod;
    const logFilePath = path.join(app.getPath('userData'), 'logs', 'main.log');
    log.transports.file.level = 'info';
    log.transports.file.resolvePathFn = () => logFilePath;
    if (log.transports.console) {
      log.transports.console.level = app.isPackaged ? 'info' : 'debug';
    }
    if (typeof log.initialize === 'function') {
      try { log.initialize(); } catch { /* ignore */ }
    }
    configured = {
      info: (...args) => log.info(...args),
      warn: (...args) => log.warn(...args),
      error: (...args) => log.error(...args),
    };
  } catch (err) {
    console.error('[main-log] Failed to configure electron-log:', err);
    configured = consoleFallback;
  }
}

/**
 * Active logger. Before `initMainLog()` runs (or if it fails), this proxies
 * to `console` so callers can log freely from module-load time.
 */
export const mainLog: MainLog = {
  info: (...args) => (configured ?? consoleFallback).info(...args),
  warn: (...args) => (configured ?? consoleFallback).warn(...args),
  error: (...args) => (configured ?? consoleFallback).error(...args),
};
