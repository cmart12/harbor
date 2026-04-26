import { appendEvent } from '../eventlog';

/**
 * Persistence gateway — enforces log-first writes.
 *
 * All state changes flow through this module:
 * 1. Append to event log (source of truth)
 * 2. Apply to SQLite database (derived view)
 *
 * If step 2 fails, the event log still has the data
 * and the database can be rebuilt on next startup.
 */
export function persistEvent(
  logPath: string,
  op: string,
  data: Record<string, any>,
  applyToDb: () => void,
): void {
  appendEvent(logPath, op, data);
  try {
    applyToDb();
  } catch (err) {
    console.error('[persistence] DB apply failed (event log is safe):', err);
  }
}
