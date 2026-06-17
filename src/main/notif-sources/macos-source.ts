/**
 * macOS notification source orchestrator (Phase A.2).
 *
 * Lives in the main process. Owns:
 *  - the Node Worker thread (`macos-worker.ts`) that does the actual
 *    SQLite reads,
 *  - the cursor (latest `received_at` we've persisted), kept in
 *    `notif-db.ts`'s `notif_meta` table,
 *  - writing parsed rows into the sidecar `notifications.db`,
 *  - emitting `notification:new` IPC events to the renderer.
 *
 * Crash isolation: if the worker dies we log + retry ONCE with a 5s
 * backoff. After that we give up rather than thrashing.
 *
 * Dedupe: macOS rows carry a stable UUID (`record.uuid`), which we use as
 * the sidecar DB's PRIMARY KEY. `INSERT OR IGNORE` makes re-ingestion a
 * no-op. We do NOT use blake3 day-bucketed hashing here — that scheme is
 * for sources like Teams/WorkIQ where there is no stable per-message ID
 * (Phase C will add `blake3` and use it there).
 */

import * as path from 'path';
import { Worker } from 'worker_threads';
import {
  insertNotification,
  getMeta,
  setMeta,
  getNotification,
} from '../notif-db';
import { sendToAllWindows } from '../ipc';
import { enqueueForClassification } from '../classifier/classifier';
import { mainLog } from '../main-log';
import type { NotifSource } from './types';

const CURSOR_KEY = 'macos_cursor';
const MAX_RESTARTS = 1;
const RESTART_BACKOFF_MS = 5_000;

type WorkerMessage =
  | {
      type: 'notification';
      source_uid: string;
      app_id: string | null;
      subject: string | null;
      body: string | null;
      sender_name: string | null;
      deep_link: string | null;
      received_at: string;
    }
  | { type: 'cursor'; value: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export class MacOSNotifSource implements NotifSource {
  readonly name = 'macos';
  private worker: Worker | null = null;
  private restartCount = 0;
  private stopping = false;

  async start(): Promise<void> {
    if (this.worker) return;
    if (process.platform !== 'darwin') {
      mainLog.info('[macos-source] Skipping - not macOS');
      return;
    }
    this.spawnWorker();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (!this.worker) return;
    const w = this.worker;
    this.worker = null;
    try {
      w.postMessage({ type: 'stop' });
      // Give the worker a beat to acknowledge, then force-terminate.
      await Promise.race([
        new Promise<void>((resolve) => w.on('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
      ]);
      await w.terminate();
    } catch (err) {
      mainLog.warn('[macos-source] worker shutdown error:', err);
    }
  }

  private spawnWorker(): void {
    // The worker source lives in `dist/main/notif-sources/macos-worker.js`
    // after build; tsc preserves the directory layout so `__dirname` here
    // is `dist/main/notif-sources` (same folder as this compiled file).
    const workerPath = path.join(__dirname, 'macos-worker.js');
    const w = new Worker(workerPath);
    this.worker = w;

    w.on('message', (msg: WorkerMessage) => this.handleMessage(msg));
    w.on('error', (err) => {
      mainLog.error('[macos-source] worker error:', err);
    });
    w.on('exit', (code) => {
      if (this.stopping) return;
      mainLog.warn(`[macos-source] worker exited with code ${code}`);
      this.worker = null;
      if (this.restartCount < MAX_RESTARTS) {
        this.restartCount += 1;
        setTimeout(() => {
          if (!this.stopping) this.spawnWorker();
        }, RESTART_BACKOFF_MS).unref?.();
      } else {
        mainLog.error('[macos-source] worker died too many times, giving up');
      }
    });

    // Seed the cursor from disk so we don't re-ingest on every app restart.
    const cursor = (() => {
      try {
        return getMeta(CURSOR_KEY);
      } catch (err) {
        mainLog.warn('[macos-source] cursor read failed:', err);
        return null;
      }
    })();
    w.postMessage({ type: 'init', cursor });
  }

  private handleMessage(msg: WorkerMessage): void {
    switch (msg.type) {
      case 'log': {
        const fn = msg.level === 'error' ? mainLog.error :
          msg.level === 'warn' ? mainLog.warn : mainLog.info;
        fn(`[macos-source:worker] ${msg.message}`);
        return;
      }
      case 'cursor': {
        try {
          setMeta(CURSOR_KEY, msg.value);
        } catch (err) {
          mainLog.warn('[macos-source] cursor write failed:', err);
        }
        return;
      }
      case 'notification': {
        try {
          const inserted = insertNotification({
            source_uid: msg.source_uid,
            source: 'macos',
            app_id: msg.app_id,
            sender_name: msg.sender_name,
            sender_email: null,
            subject: msg.subject,
            body: msg.body,
            received_at: msg.received_at,
            deep_link: msg.deep_link,
          });
          if (inserted) {
            const row = getNotification(msg.source_uid);
            if (row) {
              // Hand off to the B.2 classifier before announcing the
              // row — the renderer subscribes to `notification:updated`
              // for the badge repaint, so emit order doesn't actually
              // matter for UI correctness. Enqueue first keeps the
              // queue depth tight against feed render latency.
              try { enqueueForClassification(msg.source_uid); } catch (err) {
                mainLog.warn('[macos-source] enqueue classifier failed:', err);
              }
              sendToAllWindows('notification:new', row);
            }
          }
        } catch (err) {
          mainLog.warn('[macos-source] insert failed:', err);
        }
        return;
      }
    }
  }
}
