/**
 * Source IPC handlers (Phase C.1).
 *
 * Thin wrappers that read/write `source_settings` and control the
 * WorkIQ + macOS source instances. The actual source instances are
 * registered via `setSourceRegistry()` from `main.ts` at startup.
 */

import { registerHandler } from './typed-handler';
import {
  listSourceSettings,
  getSourceSettings,
  setSourceSettings,
} from '../notif-db';
import type { SourceStatus } from '../../shared/ipc-contract';

// ---------------------------------------------------------------------------
// Source registry - set from main.ts so handlers can control sources
// ---------------------------------------------------------------------------

interface SourceController {
  isRunning(source: string): boolean;
  setEnabled(source: string, enabled: boolean): void;
  forceRebackfill(source: string): void;
  pollNow(source: string): void;
}

let controller: SourceController | null = null;

export function setSourceController(c: SourceController): void {
  controller = c;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function buildStatus(source: string): SourceStatus {
  const settings = getSourceSettings(source);
  return {
    source,
    enabled: settings?.enabled ?? false,
    is_running: controller?.isRunning(source) ?? false,
    last_poll_iso: settings?.last_poll_iso ?? null,
    last_error: settings?.last_error ?? null,
    last_cursor_iso: settings?.last_cursor_iso ?? null,
  };
}

export function registerSourceHandlers(): void {
  registerHandler('source:list', () => {
    const all = listSourceSettings();
    return all.map(s => ({
      source: s.source,
      enabled: s.enabled,
      is_running: controller?.isRunning(s.source) ?? false,
      last_poll_iso: s.last_poll_iso,
      last_error: s.last_error,
      last_cursor_iso: s.last_cursor_iso,
    }));
  });

  registerHandler('source:get-status', (_event, source) => {
    return buildStatus(source);
  });

  registerHandler('source:set-enabled', (_event, params) => {
    setSourceSettings(params.source, { enabled: params.enabled });
    controller?.setEnabled(params.source, params.enabled);
    return { ok: true } as const;
  });

  registerHandler('source:force-rebackfill', (_event, source) => {
    setSourceSettings(source, { last_cursor_iso: null });
    controller?.forceRebackfill(source);
    return { ok: true } as const;
  });

  registerHandler('source:poll-now', (_event, source) => {
    controller?.pollNow(source);
    return { ok: true } as const;
  });
}
