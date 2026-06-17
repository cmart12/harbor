/**
 * Slack notification source orchestrator (Phase C.4).
 *
 * Lives in the main process. Owns:
 *  - the Node Worker thread (`slack-worker.ts`) that runs the poll
 *    scheduler, prompt builder, parser, and blake3 dedupe,
 *  - the cached Copilot SDK session (the worker cannot import Electron
 *    so all SDK round-trips happen here, in main),
 *  - writing parsed notifications into the sidecar `notifications.db`,
 *  - updating `source_settings` (cursor, last_poll, error),
 *  - emitting `notification:new` IPC events to the renderer.
 *
 * Mirrors the C.1 WorkIQ orchestrator pattern exactly. The only
 * differences are: single `slack` source (no outlook/teams split),
 * `slackApprovalHandler` instead of `workiqApprovalHandler`, and
 * `mcpServers: { slack: ... }` filtering.
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
import { slackThreadId } from './thread-id';
import { sendToAllWindows } from '../ipc/typed-handler';
import { enqueueForClassification } from '../classifier/classifier';
import type { NotifSource } from './types';
import type { SlackWorkerOutbound, SlackWorkerInbound } from './slack-worker';
import { mainLog, safeStringify } from '../main-log';

const MAX_RESTARTS = 2;
const RESTART_BACKOFF_MS = 10_000;
const SDK_TIMEOUT_MS = 180_000;

const SYSTEM_MESSAGE = `You are a notification bridge. When asked, query the user's Slack messages via the Slack MCP and return the results as a JSON array. Return ONLY the JSON array, no markdown fences, no commentary.`;

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

export class SlackNotifSource implements NotifSource {
  readonly name = 'slack';
  private worker: Worker | null = null;
  private restartCount = 0;
  private stopping = false;
  private cachedSession: CopilotSession | null = null;
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
      w.postMessage({ type: 'stop' } satisfies SlackWorkerInbound);
      await Promise.race([
        new Promise<void>(resolve => w.on('exit', () => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 2_000)),
      ]);
      await w.terminate();
    } catch (err) {
      mainLog.warn('[slack-source] worker shutdown error:', err);
    }
  }

  pollNow(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'poll-now' } satisfies SlackWorkerInbound);
    }
  }

  private spawnWorker(): void {
    const workerPath = path.join(__dirname, 'slack-worker.js');
    const w = new Worker(workerPath);
    this.worker = w;

    w.on('message', (msg: SlackWorkerOutbound) => { void this.handleMessage(msg); });
    w.on('error', (err) => {
      const detail = describeError(err);
      this.lastRawError = detail;
      mainLog.error('[slack-source] worker error:', detail);
      this.setError(detail);
    });
    w.on('exit', (code) => {
      if (this.stopping) return;
      const exitMsg = `worker exited with code ${code}`;
      mainLog.warn(`[slack-source] ${exitMsg}; lastRawError=${this.lastRawError ?? '(none)'}`);
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
        mainLog.error(`[slack-source] worker died too many times: ${finalError}`);
        this.setError(finalError);
      }
    });

    const settings = this.safeGetSettings('slack');
    const cursor = settings?.last_cursor_iso ?? null;
    w.postMessage({ type: 'init', cursor } satisfies SlackWorkerInbound);
  }

  private async handleMessage(msg: SlackWorkerOutbound): Promise<void> {
    switch (msg.type) {
      case 'log': {
        const fn = msg.level === 'error' ? mainLog.error :
          msg.level === 'warn' ? mainLog.warn : mainLog.info;
        fn(`[slack-source:worker] ${msg.message}`);
        return;
      }
      case 'error': {
        this.lastRawError = msg.error;
        mainLog.error('[slack-source] worker reported error:', msg.error);
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
            const threadId = slackThreadId({
              channel_id: item.channel_id,
              sender_name: item.sender_name,
              subject: item.subject,
            });
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
              thread_id: threadId,
            });
            if (inserted) {
              const row = getNotification(item.source_uid);
              if (row) {
                try { enqueueForClassification(item.source_uid); } catch (err) {
                  mainLog.warn('[slack-source] enqueue classifier failed:', err);
                }
                sendToAllWindows('notification:new', row);
              }
            }
          }

          this.updateSourceAfterPoll(msg.cursor, now);
          this.lastRawError = null;
          this.restartCount = 0;

          sendToAllWindows('source:status-changed');
        } catch (err) {
          mainLog.warn('[slack-source] insert batch failed:', err);
        }
        return;
      }
    }
  }

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
        } satisfies SlackWorkerInbound);
        return;
      }
      const response = await session.sendAndWait({ prompt }, SDK_TIMEOUT_MS);

      if (response) {
        mainLog.info('[slack-source] SDK response keys:', Object.keys(response));
        const data = response.data;
        mainLog.info('[slack-source] SDK response.data keys:', Object.keys(data));
        mainLog.info('[slack-source] SDK response.data.content (first 800):',
          (data.content ?? '').slice(0, 800) || '(empty)');
        const diagnosticFields: Record<string, unknown> = {};
        if (data.toolRequests?.length) diagnosticFields.toolRequests = data.toolRequests;
        if (data.model) diagnosticFields.model = data.model;
        if (data.phase) diagnosticFields.phase = data.phase;
        if (data.messageId) diagnosticFields.messageId = data.messageId;
        if (Object.keys(diagnosticFields).length > 0) {
          mainLog.info('[slack-source] SDK response diagnostic fields:',
            safeStringify(diagnosticFields).slice(0, 1500));
        }
      } else {
        mainLog.warn('[slack-source] SDK response was null/undefined');
      }

      let text = response?.data?.content ?? '';

      // Follow-up prompt when model executed tools but returned empty content
      const toolRequests = response?.data?.toolRequests;
      if (!text && toolRequests?.length) {
        mainLog.info(
          `[slack-source] SDK returned empty content with ${toolRequests.length} tool request(s). Issuing follow-up prompt.`,
        );
        mainLog.info(
          '[slack-source] Tool requests:',
          safeStringify(toolRequests).slice(0, 1500),
        );

        try {
          const followUp = await session.sendAndWait(
            { prompt: 'Please return the items you fetched as a JSON array matching this schema: [{source, source_uid, sender_name, sender_email, subject, body, received_at, deep_link, channel_id, thread_ts}]. Return ONLY the JSON array, no prose.' },
            SDK_TIMEOUT_MS,
          );
          const followUpText = followUp?.data?.content ?? '';
          mainLog.info(
            '[slack-source] Follow-up response.data keys:',
            followUp?.data ? Object.keys(followUp.data).join(', ') : '(null)',
          );
          mainLog.info(
            '[slack-source] Follow-up response.data.content (first 800):',
            followUpText.slice(0, 800) || '(empty)',
          );
          if (followUpText) {
            text = followUpText;
          }
        } catch (followUpErr) {
          mainLog.warn('[slack-source] Follow-up prompt failed:', followUpErr);
        }
      }

      w.postMessage({
        type: 'sdk-response',
        id,
        success: true,
        text,
      } satisfies SlackWorkerInbound);
    } catch (err) {
      this.dropSession();
      const message = err instanceof Error ? err.message : String(err);
      if (w === this.worker) {
        w.postMessage({
          type: 'sdk-response',
          id,
          success: false,
          error: message,
        } satisfies SlackWorkerInbound);
      }
    }
  }

  private async getSession(): Promise<CopilotSession | null> {
    if (this.cachedSession) return this.cachedSession;
    const client = clientFactory();
    if (!client) return null;

    let slackMcp: Record<string, unknown> | undefined;
    try {
      const all = mcpServersFactory();
      const slack = all['slack'];
      if (slack) {
        slackMcp = { slack };
      } else {
        mainLog.warn('[slack-source] no `slack` MCP server discovered; SDK session has no tools to query Slack');
      }
    } catch (err) {
      mainLog.warn('[slack-source] mcp discovery failed:', err);
    }

    try {
      this.cachedSession = await client.createSession({
        systemMessage: { content: SYSTEM_MESSAGE },
        onPermissionRequest: slackApprovalHandler,
        createSessionFsProvider: () => new InMemoryFsProvider(),
        ...(slackMcp ? { mcpServers: slackMcp } : {}),
      } as any);
      return this.cachedSession;
    } catch (err) {
      mainLog.warn('[slack-source] createSession failed:', err);
      return null;
    }
  }

  private dropSession(): void {
    if (this.cachedSession) {
      try { void this.cachedSession.disconnect(); } catch { /* ignore */ }
    }
    this.cachedSession = null;
  }

  private updateSourceAfterPoll(cursor: string, pollIso: string): void {
    try {
      setSourceSettings('slack', {
        last_cursor_iso: cursor,
        last_poll_iso: pollIso,
        last_error: null,
      });
    } catch (err) {
      mainLog.warn('[slack-source] settings update failed:', err);
    }
  }

  private setError(error: string): void {
    try {
      setSourceSettings('slack', { last_error: error });
    } catch (err) {
      mainLog.warn('[slack-source] error write failed:', err);
    }
    sendToAllWindows('source:status-changed');
  }

  private safeGetSettings(source: string): { last_cursor_iso: string | null } | null {
    try {
      return getSourceSettings(source);
    } catch (err) {
      mainLog.warn(`[slack-source] settings read failed for ${source}:`, err);
      return null;
    }
  }
}

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
 * Permission handler for the Slack background poller session.
 *
 * Allowlist:
 *  - kind: 'mcp'                          AND serverName === 'slack'    -> approve
 *  - kind: 'extension-management'         AND extensionName === 'slack' -> approve
 *  - kind: 'extension-permission-access'  AND extensionName === 'slack' -> approve
 *  - kind: 'read'                         (harmless, model may peek)    -> approve
 *
 * Everything else is rejected.
 */
export async function slackApprovalHandler(request: unknown): Promise<{ kind: 'approve-once' | 'reject' }> {
  const req = request as { kind?: string; serverName?: string; extensionName?: string };
  switch (req.kind) {
    case 'mcp':
      return req.serverName === 'slack'
        ? { kind: 'approve-once' as const }
        : { kind: 'reject' as const };
    case 'extension-management':
    case 'extension-permission-access':
      return req.extensionName === 'slack'
        ? { kind: 'approve-once' as const }
        : { kind: 'reject' as const };
    case 'read':
      return { kind: 'approve-once' as const };
    default:
      return { kind: 'reject' as const };
  }
}
