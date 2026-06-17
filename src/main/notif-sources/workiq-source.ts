/**
 * WorkIQ notification source orchestrator (Phase C.1).
 *
 * Lives in the main process. Owns:
 *  - the Node Worker thread (`workiq-worker.ts`) that runs the SDK poll loop,
 *  - writing parsed notifications into the sidecar `notifications.db`,
 *  - updating `source_settings` (cursor, last_poll, error),
 *  - emitting `notification:new` IPC events to the renderer,
 *  - managing two logical sources: `workiq-outlook` and `workiq-teams`.
 *
 * Follows the A.2 macOS-source pattern: orchestrator + worker with
 * parentPort message-passing, dedupe in parent via `INSERT OR IGNORE`,
 * IPC events from parent.
 */

import * as path from 'path';
import { Worker } from 'worker_threads';
import {
  insertNotification,
  getNotification,
  getSourceSettings,
  setSourceSettings,
} from '../notif-db';
import { sendToAllWindows } from '../ipc/typed-handler';
import { enqueueForClassification } from '../classifier/classifier';
import type { NotifSource } from './types';
import type { WorkerOutbound, WorkerInbound } from './workiq-worker';

const MAX_RESTARTS = 2;
const RESTART_BACKOFF_MS = 10_000;

/**
 * Manages both `workiq-outlook` and `workiq-teams` through a single
 * worker thread. The worker discriminates source from the SDK response;
 * the orchestrator writes each item with the correct `source` field.
 */
export class WorkIQNotifSource implements NotifSource {
  readonly name = 'workiq';
  private worker: Worker | null = null;
  private restartCount = 0;
  private stopping = false;

  async start(): Promise<void> {
    if (this.worker) return;
    this.stopping = false;
    this.restartCount = 0;
    this.spawnWorker();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (!this.worker) return;
    const w = this.worker;
    this.worker = null;
    try {
      w.postMessage({ type: 'stop' } satisfies WorkerInbound);
      await Promise.race([
        new Promise<void>(resolve => w.on('exit', () => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 2_000)),
      ]);
      await w.terminate();
    } catch (err) {
      console.warn('[workiq-source] worker shutdown error:', err);
    }
  }

  /** Trigger an immediate poll without waiting for the interval timer. */
  pollNow(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'poll-now' } satisfies WorkerInbound);
    }
  }

  private spawnWorker(): void {
    const workerPath = path.join(__dirname, 'workiq-worker.js');
    const w = new Worker(workerPath);
    this.worker = w;

    w.on('message', (msg: WorkerOutbound) => this.handleMessage(msg));
    w.on('error', (err) => {
      console.error('[workiq-source] worker error:', err);
      this.setError(err instanceof Error ? err.message : String(err));
    });
    w.on('exit', (code) => {
      if (this.stopping) return;
      console.warn(`[workiq-source] worker exited with code ${code}`);
      this.worker = null;
      if (this.restartCount < MAX_RESTARTS) {
        this.restartCount += 1;
        setTimeout(() => {
          if (!this.stopping) this.spawnWorker();
        }, RESTART_BACKOFF_MS).unref?.();
      } else {
        console.error('[workiq-source] worker died too many times, giving up');
        this.setError('Worker crashed repeatedly');
      }
    });

    // Seed cursor from the earliest of the two WorkIQ sources
    const outlookSettings = this.safeGetSettings('workiq-outlook');
    const teamsSettings = this.safeGetSettings('workiq-teams');

    let cursor: string | null = null;
    const cursors = [
      outlookSettings?.last_cursor_iso,
      teamsSettings?.last_cursor_iso,
    ].filter((c): c is string => typeof c === 'string' && c.length > 0);

    if (cursors.length > 0) {
      // Use the earliest cursor so we don't miss items from either source
      cursors.sort();
      cursor = cursors[0];
    }

    w.postMessage({ type: 'init', cursor } satisfies WorkerInbound);
  }

  private handleMessage(msg: WorkerOutbound): void {
    switch (msg.type) {
      case 'log': {
        const fn = msg.level === 'error' ? console.error :
          msg.level === 'warn' ? console.warn : console.log;
        fn(`[workiq-source:worker] ${msg.message}`);
        return;
      }
      case 'error': {
        this.setError(msg.error);
        return;
      }
      case 'notifications': {
        const now = new Date().toISOString();
        try {
          for (const item of msg.items) {
            const inserted = insertNotification({
              source_uid: item.source_uid,
              source: item.source,
              app_id: null,
              sender_name: item.sender_name,
              sender_email: item.sender_email,
              subject: item.subject,
              body: item.body,
              received_at: item.received_at,
              deep_link: item.deep_link,
            });
            if (inserted) {
              const row = getNotification(item.source_uid);
              if (row) {
                try { enqueueForClassification(item.source_uid); } catch (err) {
                  console.warn('[workiq-source] enqueue classifier failed:', err);
                }
                sendToAllWindows('notification:new', row);
              }
            }
          }

          // Update cursor + last poll for both WorkIQ sources
          this.updateSourceAfterPoll('workiq-outlook', msg.cursor, now);
          this.updateSourceAfterPoll('workiq-teams', msg.cursor, now);

          // Broadcast source status change
          sendToAllWindows('source:status-changed');
        } catch (err) {
          console.warn('[workiq-source] insert batch failed:', err);
        }
        return;
      }
    }
  }

  private updateSourceAfterPoll(source: string, cursor: string, pollIso: string): void {
    try {
      setSourceSettings(source, {
        last_cursor_iso: cursor,
        last_poll_iso: pollIso,
        last_error: null,
      });
    } catch (err) {
      console.warn(`[workiq-source] settings update failed for ${source}:`, err);
    }
  }

  private setError(error: string): void {
    for (const source of ['workiq-outlook', 'workiq-teams'] as const) {
      try {
        setSourceSettings(source, { last_error: error });
      } catch (err) {
        console.warn(`[workiq-source] error write failed for ${source}:`, err);
      }
    }
    sendToAllWindows('source:status-changed');
  }

  private safeGetSettings(source: string): { last_cursor_iso: string | null } | null {
    try {
      return getSourceSettings(source);
    } catch (err) {
      console.warn(`[workiq-source] settings read failed for ${source}:`, err);
      return null;
    }
  }
}
