/**
 * WorkIQ notification source orchestrator (Phase C.1).
 *
 * Lives in the main process. Owns:
 *  - the Node Worker thread (`workiq-worker.ts`) that runs the poll
 *    scheduler, prompt builder, parser, and blake3 dedupe,
 *  - the cached Copilot SDK session (the worker cannot import Electron
 *    so all SDK round-trips happen here, in main),
 *  - writing parsed notifications into the sidecar `notifications.db`,
 *  - updating `source_settings` (cursor, last_poll, error),
 *  - emitting `notification:new` IPC events to the renderer,
 *  - managing two logical sources: `workiq-outlook` and `workiq-teams`.
 *
 * Follows the A.2 macOS-source pattern: orchestrator + worker with
 * parentPort message-passing, dedupe in parent via `INSERT OR IGNORE`,
 * IPC events from parent. The only deviation is the request-poll
 * round-trip: worker asks parent to call the SDK, parent posts the
 * response back. This keeps the worker thread Electron-free.
 */

import * as path from 'path';
import { Worker } from 'worker_threads';
import type { CopilotSession } from '@github/copilot-sdk';
import { getEphemeralCopilotClient } from '../ai';
import { InMemoryFsProvider } from '../agents/in-memory-fs-provider';
import { getAllMcpServers } from '../mcp';
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
import { mainLog } from '../main-log';

const MAX_RESTARTS = 2;
const RESTART_BACKOFF_MS = 10_000;
const SDK_TIMEOUT_MS = 180_000; // 3 min — WorkIQ first-run (EULA + 7-day backfill + Graph) regularly exceeded 60s.

const SYSTEM_MESSAGE = `You are a notification bridge. When asked, query the user's Microsoft 365 data via WorkIQ and return the results as a JSON array. Return ONLY the JSON array, no markdown fences, no commentary.`;

// ---------------------------------------------------------------------------
// Injection seam: tests swap the SDK client factory.
// ---------------------------------------------------------------------------

type ClientFactory = typeof getEphemeralCopilotClient;
let clientFactory: ClientFactory = getEphemeralCopilotClient;

type McpServersFactory = typeof getAllMcpServers;
let mcpServersFactory: McpServersFactory = getAllMcpServers;

/** Test-only: replace the SDK client factory with a mock. */
export function _setClientFactory(factory: ClientFactory): void {
  clientFactory = factory;
}
/** Test-only: restore default factory. */
export function _resetClientFactoryForTests(): void {
  clientFactory = getEphemeralCopilotClient;
  mcpServersFactory = getAllMcpServers;
}
/** Test-only: replace the MCP discovery factory with a mock. */
export function _setMcpServersFactory(factory: McpServersFactory): void {
  mcpServersFactory = factory;
}

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
  private cachedSession: CopilotSession | null = null;
  /** Most recent raw error from worker 'error' / 'exit' / SDK call, used as
   *  the `last_error` payload before falling back to the generic crash
   *  message. Survives across restarts so the UI can show the real cause. */
  private lastRawError: string | null = null;

  async start(): Promise<void> {
    if (this.worker) return;
    this.stopping = false;
    this.restartCount = 0;
    this.spawnWorker();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.dropSession();
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

    w.on('message', (msg: WorkerOutbound) => { void this.handleMessage(msg); });
    w.on('error', (err) => {
      const detail = describeError(err);
      this.lastRawError = detail;
      console.error('[workiq-source] worker error:', err);
      mainLog.error('[workiq-source] worker error:', detail);
      this.setError(detail);
    });
    w.on('exit', (code) => {
      if (this.stopping) return;
      const exitMsg = `worker exited with code ${code}`;
      console.warn(`[workiq-source] ${exitMsg}`);
      mainLog.warn(`[workiq-source] ${exitMsg}; lastRawError=${this.lastRawError ?? '(none)'}`);
      // Capture exit code as raw error if we have nothing better. The 'error'
      // handler usually fires first with a real Error object, but for some
      // failure modes (immediate exit, segfault) we only see the exit code.
      if (!this.lastRawError && code !== 0) {
        this.lastRawError = `worker exited with code ${code}`;
      }
      this.worker = null;
      if (this.restartCount < MAX_RESTARTS) {
        this.restartCount += 1;
        setTimeout(() => {
          if (!this.stopping) this.spawnWorker();
        }, RESTART_BACKOFF_MS).unref?.();
      } else {
        const finalError = this.lastRawError
          ? `Worker crashed repeatedly. Last error: ${this.lastRawError}`
          : 'Worker crashed repeatedly';
        console.error(`[workiq-source] worker died too many times: ${finalError}`);
        mainLog.error('[workiq-source] worker died too many times:', finalError);
        this.setError(finalError);
      }
    });

    const outlookSettings = this.safeGetSettings('workiq-outlook');
    const teamsSettings = this.safeGetSettings('workiq-teams');

    let cursor: string | null = null;
    const cursors = [
      outlookSettings?.last_cursor_iso,
      teamsSettings?.last_cursor_iso,
    ].filter((c): c is string => typeof c === 'string' && c.length > 0);

    if (cursors.length > 0) {
      cursors.sort();
      cursor = cursors[0];
    }

    w.postMessage({ type: 'init', cursor } satisfies WorkerInbound);
  }

  private async handleMessage(msg: WorkerOutbound): Promise<void> {
    switch (msg.type) {
      case 'log': {
        const fn = msg.level === 'error' ? console.error :
          msg.level === 'warn' ? console.warn : console.log;
        fn(`[workiq-source:worker] ${msg.message}`);
        return;
      }
      case 'error': {
        this.lastRawError = msg.error;
        mainLog.error('[workiq-source] worker reported error:', msg.error);
        this.setError(msg.error);
        return;
      }
      case 'request-poll': {
        await this.handleSdkRequest(msg.id, msg.prompt);
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

          this.updateSourceAfterPoll('workiq-outlook', msg.cursor, now);
          this.updateSourceAfterPoll('workiq-teams', msg.cursor, now);
          // Healthy poll clears prior crash bookkeeping so a future
          // single crash doesn't immediately trip MAX_RESTARTS again.
          this.lastRawError = null;
          this.restartCount = 0;

          sendToAllWindows('source:status-changed');
        } catch (err) {
          console.warn('[workiq-source] insert batch failed:', err);
        }
        return;
      }
    }
  }

  /**
   * Handle a `request-poll` from the worker by calling the SDK in the
   * main process and posting the response (or error) back to the worker.
   */
  private async handleSdkRequest(id: string, prompt: string): Promise<void> {
    const w = this.worker;
    if (!w) return;
    try {
      const session = await this.getSession();
      if (!session) {
        w.postMessage({
          type: 'sdk-response',
          id,
          success: false,
          error: 'No SDK session available',
        } satisfies WorkerInbound);
        return;
      }
      const response = await session.sendAndWait({ prompt }, SDK_TIMEOUT_MS) as
        { data?: { content?: string } } | null;
      const text = response?.data?.content ?? '';
      w.postMessage({
        type: 'sdk-response',
        id,
        success: true,
        text,
      } satisfies WorkerInbound);
    } catch (err) {
      this.dropSession();
      const message = err instanceof Error ? err.message : String(err);
      if (w === this.worker) {
        w.postMessage({
          type: 'sdk-response',
          id,
          success: false,
          error: message,
        } satisfies WorkerInbound);
      }
    }
  }

  private async getSession(): Promise<CopilotSession | null> {
    if (this.cachedSession) return this.cachedSession;
    const client = clientFactory();
    if (!client) return null;

    // Filter discovered MCPs to just the workiq server. The full set
    // (DataDog, Kusto, Slack, etc.) would bloat the tool list and pollute
    // the session for a query that only needs Outlook + Teams. The custom
    // entries already override discovered ones in `getAllMcpServers()`,
    // so picking the `workiq` key here gets Chris's config copy if it
    // exists, otherwise the plugin-discovered one.
    let workiqMcp: Record<string, unknown> | undefined;
    try {
      const all = mcpServersFactory();
      const wiq = all['workiq'];
      if (wiq) {
        workiqMcp = { workiq: wiq };
      } else {
        mainLog.warn('[workiq-source] no `workiq` MCP server discovered; SDK session has no tools to query Outlook/Teams');
      }
    } catch (err) {
      mainLog.warn('[workiq-source] mcp discovery failed:', err);
    }

    try {
      this.cachedSession = await client.createSession({
        systemMessage: { content: SYSTEM_MESSAGE },
        // This is a background poller -- there is no UI to surface
        // approval prompts to. Auto-approve anything originating from
        // the workiq MCP / extension (tool calls, EULA, capability
        // grants). Approve plain reads too in case the model wants to
        // peek at config. Reject everything else: shell, write, url,
        // memory, custom tools, hooks, and any non-workiq MCP. This is
        // a tight allowlist rather than full `yoloMode: true` so a
        // misconfigured prompt can't surprise us with side effects.
        onPermissionRequest: workiqApprovalHandler,
        createSessionFsProvider: () => new InMemoryFsProvider(),
        ...(workiqMcp ? { mcpServers: workiqMcp } : {}),
      } as any);
      return this.cachedSession;
    } catch (err) {
      console.warn('[workiq-source] createSession failed:', err);
      return null;
    }
  }

  private dropSession(): void {
    if (this.cachedSession) {
      try { void this.cachedSession.disconnect(); } catch { /* ignore */ }
    }
    this.cachedSession = null;
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

/**
 * Render an unknown error into a useful single string for logging and for
 * `last_error` persistence. Captures message + first ~500 chars of stack so
 * the UI tooltip can show meaningful detail without becoming unreadable.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const stack = err.stack ? `\n${err.stack.slice(0, 500)}` : '';
    return `${err.message}${stack}`;
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Permission handler for the workiq background poller session.
 *
 * Allowlist:
 *  - kind: 'mcp'                          AND serverName === 'workiq'   → approve
 *  - kind: 'extension-management'         AND extensionName === 'workiq' → approve
 *  - kind: 'extension-permission-access'  AND extensionName === 'workiq' → approve
 *  - kind: 'read'                         (harmless, model may peek)    → approve
 *
 * Everything else (shell, write, url, memory, custom-tool, hook, and
 * any MCP/extension whose name is not 'workiq') is rejected so a
 * misconfigured prompt cannot trigger arbitrary side effects.
 *
 * Exported for tests. Future C.3 (context-gathering agent) should use
 * the same shape — pass it an allowed-server set instead of hard-coding.
 */
export async function workiqApprovalHandler(request: unknown): Promise<{ kind: 'approve-once' | 'reject' }> {
  const req = request as { kind?: string; serverName?: string; extensionName?: string };
  switch (req.kind) {
    case 'mcp':
      return req.serverName === 'workiq'
        ? { kind: 'approve-once' as const }
        : { kind: 'reject' as const };
    case 'extension-management':
    case 'extension-permission-access':
      return req.extensionName === 'workiq'
        ? { kind: 'approve-once' as const }
        : { kind: 'reject' as const };
    case 'read':
      return { kind: 'approve-once' as const };
    default:
      return { kind: 'reject' as const };
  }
}
