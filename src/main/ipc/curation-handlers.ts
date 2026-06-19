/**
 * Curation run IPC handlers (Phase E.1 + E.2a).
 *
 * E.1: `curation:list-runs` (read-only)
 * E.2a: `curation:run-morning-now` + `curation:get-progress`
 */

import { registerHandler } from './typed-handler';
import { listCurationRuns, getCurationRun } from '../notif-db';
import { runMorningCuration } from '../curation/morning-curator';
import { mainLog } from '../main-log';

export function registerCurationHandlers(): void {
  registerHandler('curation:list-runs', (_event, params) => {
    return listCurationRuns(params ?? {});
  });

  registerHandler('curation:run-morning-now', async (_event) => {
    try {
      const result = await runMorningCuration();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainLog.error('[curation-handler] run-morning-now failed:', msg);
      return { error: msg };
    }
  });

  registerHandler('curation:get-progress', (_event, runId) => {
    const run = getCurationRun(runId);
    if (!run) return { status: 'unknown' };
    return { status: run.status, phase: run.status === 'running' ? 'Gathering context...' : undefined };
  });
}

