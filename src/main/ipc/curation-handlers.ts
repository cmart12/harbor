/**
 * Curation run IPC handlers (Phase E.1).
 *
 * Read-only in E.1: only `curation:list-runs` is wired. No runs are
 * created by the app yet; this scaffolding lets E.2 plug in cleanly.
 */

import { registerHandler } from './typed-handler';
import { listCurationRuns } from '../notif-db';

export function registerCurationHandlers(): void {
  registerHandler('curation:list-runs', (_event, params) => {
    return listCurationRuns(params ?? {});
  });
}
