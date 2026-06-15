/**
 * Classifier IPC handlers (Phase B.2).
 *
 * Thin pass-throughs to the classifier orchestrator and notif-db. Every
 * mutation eventually emits `notification:updated` / `classifier:progress`
 * from inside the orchestrator, so handlers stay synchronous-feeling and
 * never duplicate event fan-out.
 */

import { registerHandler } from './typed-handler';
import {
  reclassifyAll,
  reclassifyOne,
  retryFailed,
  pendingCount,
  failedCount,
} from '../classifier/classifier';
import {
  countActiveByGoal,
  countActiveByCategory,
} from '../notif-db';

export function registerClassifierHandlers(): void {
  registerHandler('classifier:reclassify-all', () => {
    return reclassifyAll();
  });

  registerHandler('classifier:retry-failed', () => {
    return retryFailed();
  });

  registerHandler('classifier:reclassify-one', async (_event, uid) => {
    if (typeof uid !== 'string' || uid.length === 0) {
      // The contract returns a literal `{ ok: true }`; an empty uid is a
      // renderer bug. Resolve as ok so the UI doesn't display an error
      // while we wait for the next sweep to pick it up.
      return { ok: true as const };
    }
    await reclassifyOne(uid);
    return { ok: true as const };
  });

  registerHandler('classifier:pending-count', () => {
    return { pending: pendingCount(), failed: failedCount() };
  });

  registerHandler('goal:active-link-count', (_event, goalId) => {
    return { count: typeof goalId === 'string' ? countActiveByGoal(goalId) : 0 };
  });

  registerHandler('category:active-link-count', (_event, categoryId) => {
    return { count: typeof categoryId === 'string' ? countActiveByCategory(categoryId) : 0 };
  });
}
