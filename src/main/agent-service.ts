import { AgentAnchor, AgentSession, CanvasAgent } from '../shared/types';
import { SubagentTracker } from './subagent-service';
import { AgentRegistry } from './agents/agent-registry';
import { AgentNotifier } from './agents/agent-notifier';
import { AgentPersistence } from './agents/agent-persistence';
import { InteractionBroker } from './agents/interaction-broker';
import { listAllRunningAgents, updateCanvasAgentStatus } from './database';

// Import runner modules
import { initSdkRunner, setupAgentEventListeners } from './agents/sdk-runner';
import { initCliRunner } from './agents/cli-runner';
import { initCommentWorkflow } from './agents/comment-workflow';
import { initConduitRunner } from './agents/conduit-runner';

export type { AgentStatus } from './agents/agent-registry';

// ── Shared state ───────────────────────────────────────
const registry = new AgentRegistry();
const notifier = new AgentNotifier();
const persistence = new AgentPersistence();
const broker = new InteractionBroker(notifier, persistence);

export const subagentTracker = new SubagentTracker();

// Broadcast sub-agent changes to renderer
subagentTracker.onChange((parentAgentId) => {
  notifier.notifyRenderer(`subagent:changed:${parentAgentId}`);
});

// ── Initialize runner modules with shared deps ─────────
initSdkRunner({ registry, notifier, persistence, broker, subagentTracker });
initCliRunner({ registry, notifier, persistence });
initCommentWorkflow({ registry, notifier, persistence, broker, setupAgentEventListeners });
initConduitRunner({ registry, notifier, persistence, broker });

// ── Re-exports from SDK runner ─────────────────────────
export { buildCliToolsPrompt, launchAgent, launchQuickAgent, launchDocumentAgent, sendChatMessage, setAgentModel, getAgentHistory, enableRemoteControl, disableRemoteControl, disableSandboxForSession } from './agents/sdk-runner';

// ── App-level remote control ──────────────────────────

/**
 * Enable or disable app-level remote for all active SDK workspace-level agents.
 * Persists the setting and fires app:remote-changed.
 */
export async function setAppRemote(enabled: boolean): Promise<{ enabled: boolean; agents: Array<{ agentId: string; url?: string }> } | { error: string }> {
  const { setConfigValue } = await import('./config');
  setConfigValue('remoteEnabled', enabled);

  const { enableRemoteControl, disableRemoteControl } = await import('./agents/sdk-runner');
  const agents: Array<{ agentId: string; url?: string }> = [];

  for (const record of registry.values()) {
    // Only manage SDK agents (not CLI, CCA, or Conduit)
    if (record.status !== 'running' && record.status !== 'waiting-approval') continue;

    try {
      if (enabled) {
        const result = await enableRemoteControl(record.agentId);
        if ('url' in result) {
          agents.push({ agentId: record.agentId, url: result.url });
        }
      } else {
        await disableRemoteControl(record.agentId);
      }
    } catch (err: any) {
      console.error(`[agent-service] Failed to ${enabled ? 'enable' : 'disable'} remote for agent=${record.agentId}:`, err);
    }
  }

  notifier.notifyRenderer('app:remote-changed', { enabled, agents });
  return { enabled, agents };
}

/**
 * Get the current app-level remote status and list of agents with remote URLs.
 */
export function getAppRemoteStatus(): { enabled: boolean; agents: Array<{ agentId: string; url?: string }> } {
  const { getConfigValue } = require('./config');
  const enabled = !!getConfigValue('remoteEnabled');
  const agents: Array<{ agentId: string; url?: string }> = [];

  if (enabled) {
    for (const record of registry.values()) {
      if (record.remote?.enabled && record.remote.url) {
        agents.push({ agentId: record.agentId, url: record.remote.url });
      }
    }
  }

  return { enabled, agents };
}

// ── Re-exports from CLI runner ─────────────────────────
export { launchCliSession, startCliExitMonitor, stopCliExitMonitor, openAgentCli } from './agents/cli-runner';

// ── Re-exports from comment workflow ───────────────────
export { launchCommentAgent } from './agents/comment-workflow';

// ── Re-exports from Conduit runner ─────────────────────
export {
  launchConduitAgent,
  joinConduitSession,
  sendConduitChatMessage,
  abortConduitAgent,
  disconnectConduitAgent,
  listConduitSessions,
  listConduitProfiles,
  getConduitHostStatus,
  getConduitAgentHistory,
  approveConduitPermission,
  respondToConduitUserInput,
  openConduitAgentCli,
} from './agents/conduit-runner';

// ── Interaction passthrough ────────────────────────────

export function approveAgent(agentId: string, requestId: string, approved: boolean): void {
  broker.approveAgent(agentId, requestId, approved);
}

export function respondToUserInput(agentId: string, requestId: string, answer: string, wasFreeform: boolean): void {
  broker.respondToUserInput(agentId, requestId, answer, wasFreeform);
}

export function respondToElicitation(agentId: string, requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>): void {
  broker.respondToElicitation(agentId, requestId, action, content);
}

/**
 * Toggle yolo mode for an agent.  When enabled, all subsequent permission
 * requests are auto-approved without user interaction.  Also auto-approves
 * any currently-pending permission requests.
 */
export function setAgentYolo(agentId: string, enabled: boolean): { ok: true } | { error: string } {
  const record = registry.get(agentId);
  if (!record) return { error: 'Agent not found' };

  record.yoloMode = enabled;
  console.log(`[agent-service] yolo mode ${enabled ? 'enabled' : 'disabled'} for agent=${agentId}`);
  notifier.notifyRenderer('agent:yolo-changed', { agentId, enabled });

  // When enabling, auto-approve any pending permission requests
  if (enabled && record.pendingApprovals.size > 0) {
    for (const requestId of [...record.pendingApprovals.keys()]) {
      broker.approveAgent(agentId, requestId, true);
    }
  }

  return { ok: true };
}

/**
 * Renderer-driven resolution of a sandbox block.  For `disable`, also
 * triggers the session-swap flow in sdk-runner asynchronously; the broker
 * resolves the pending permission/pre-tool callback as approve-once so the
 * runtime can return while the swap is in flight.
 */
export async function resolveSandboxBlock(
  agentId: string,
  requestId: string,
  decision: 'allow-once' | 'allow-for-session' | 'disable',
): Promise<void> {
  // Resolve the pending broker callback first so the runtime unblocks.
  broker.resolveSandboxBlock(agentId, requestId, decision);
  if (decision === 'disable') {
    const { disableSandboxForSession } = await import('./agents/sdk-runner');
    await disableSandboxForSession(agentId).catch((err) => {
      console.error('[agent-service] disableSandboxForSession failed:', err);
    });
  }
}

// ── Agent lifecycle ────────────────────────────────────

export async function abortAgent(agentId: string): Promise<void> {
  const record = registry.get(agentId);
  if (!record) return;

  try {
    broker.clearPendingInteractions(record);
    await record.session.abort();
    record.status = 'failed';
    record.summary = 'Aborted by user';
    persistence.updateStatus(record);
    notifier.notifyRenderer('agent:status-changed', {
      agentId, status: 'failed', summary: record.summary,
    });
  } catch {
    // ignore
  }
}

// ── Query functions ────────────────────────────────────

export function listAgents(spaceId: string): Array<{ agentId: string; sessionId: string; status: import('./agents/agent-registry').AgentStatus; summary: string; selectedText: string; quotedText: string; anchor: AgentAnchor }> {
  return Array.from(registry.values())
    .filter(a => a.spaceId === spaceId)
    .map(a => ({
      agentId: a.agentId,
      sessionId: a.sessionId,
      status: a.status,
      summary: a.summary,
      selectedText: a.selectedText,
      quotedText: a.commentContext?.quotedText ?? '',
      anchor: a.anchor,
    }));
}

export function getAgentSessionId(agentId: string): string | null {
  return registry.get(agentId)?.sessionId ?? null;
}

export function listAllAgents(): Array<{ agentId: string; sessionId: string; status: import('./agents/agent-registry').AgentStatus; summary: string; selectedText: string; quotedText: string; spaceId: string; createdAt: string; pendingApprovalId: string | null; pendingPermissionKind: string | null; pendingIntention: string | null; pendingPath: string | null; source: 'sdk' | 'cli' | 'cca' | 'conduit'; personaHandle: string | null; yoloMode: boolean; sandboxed: boolean }> {
  // Read persisted sessions from DB (sorted newest first)
  let persisted: AgentSession[] = [];
  try {
    persisted = persistence.listSessions();
  } catch { /* DB may not be initialized */ }

  // Build result: overlay live in-memory state on top of DB records
  const seen = new Set<string>();
  const result: Array<{ agentId: string; sessionId: string; status: import('./agents/agent-registry').AgentStatus; summary: string; selectedText: string; quotedText: string; spaceId: string; createdAt: string; pendingApprovalId: string | null; pendingPermissionKind: string | null; pendingIntention: string | null; pendingPath: string | null; source: 'sdk' | 'cli' | 'cca' | 'conduit'; personaHandle: string | null; yoloMode: boolean; sandboxed: boolean }> = [];

  for (const row of persisted) {
    seen.add(row.id);
    const live = registry.get(row.id);
    const pendingApproval = live?.pendingApprovalId ? live.pendingApprovals.get(live.pendingApprovalId) : undefined;
    result.push({
      agentId: row.id,
      sessionId: row.session_id,
      status: (live?.status ?? row.status) as import('./agents/agent-registry').AgentStatus,
      summary: live?.summary ?? row.summary,
      selectedText: live?.selectedText ?? row.prompt,
      quotedText: live?.commentContext?.quotedText ?? row.quoted_text ?? '',
      spaceId: live?.spaceId ?? row.space_id ?? '__workspace__',
      createdAt: row.created_at,
      pendingApprovalId: live?.pendingApprovalId ?? null,
      pendingPermissionKind: live?.pendingPermissionKind ?? null,
      pendingIntention: pendingApproval?.intention ?? null,
      pendingPath: pendingApproval?.path ?? null,
      source: row.source ?? 'sdk',
      personaHandle: row.persona_handle ?? null,
      yoloMode: live?.yoloMode ?? false,
      sandboxed: live?.sandbox?.state === 'on',
    });
  }

  // Add any live agents not yet in DB (shouldn't happen, but defensive)
  for (const [id, a] of registry.entries()) {
    if (!seen.has(id)) {
      const pendingApproval = a.pendingApprovalId ? a.pendingApprovals.get(a.pendingApprovalId) : undefined;
      result.push({
        agentId: a.agentId,
        sessionId: a.sessionId,
        status: a.status,
        summary: a.summary,
        selectedText: a.selectedText,
        quotedText: a.commentContext?.quotedText ?? '',
        spaceId: a.spaceId,
        createdAt: '',
        pendingApprovalId: a.pendingApprovalId,
        pendingPermissionKind: a.pendingPermissionKind ?? null,
        pendingIntention: pendingApproval?.intention ?? null,
        pendingPath: pendingApproval?.path ?? null,
        source: 'sdk',
        personaHandle: a.commentContext?.personaHandle ?? null,
        yoloMode: a.yoloMode ?? false,
        sandboxed: a.sandbox?.state === 'on',
      });
    }
  }

  return result;
}

/**
 * Mark any DB agent sessions still in "running" or "waiting-approval" state
 * as "failed" when no corresponding live process exists.  This handles the
 * case where the app quit while agents were active — the in-memory registry
 * is lost on restart so these entries would otherwise stay stale forever.
 *
 * Call once after DB + agent-service initialization.
 */
export function reconcileStaleAgents(): void {
  const STALE_STATUSES = new Set(['running', 'waiting-approval']);

  // ── agent_sessions table ──────────────────────────────
  let persisted: AgentSession[] = [];
  try {
    persisted = persistence.listSessions();
  } catch { return; /* DB not ready */ }

  for (const row of persisted) {
    if (STALE_STATUSES.has(row.status) && !registry.has(row.id)) {
      try {
        persistence.updateSessionStatus(row.id, 'failed', 'Session lost — app restarted');
        console.log(`[agent-service] Reconciled stale agent session ${row.id}: ${row.status} → failed`);
      } catch { /* non-fatal */ }
    }
  }

  // ── canvas_agents table ───────────────────────────────
  let runningCanvas: CanvasAgent[] = [];
  try {
    runningCanvas = listAllRunningAgents();
  } catch { return; }

  for (const row of runningCanvas) {
    if (!registry.has(row.id)) {
      try {
        updateCanvasAgentStatus(row.id, 'failed');
        console.log(`[agent-service] Reconciled stale canvas agent ${row.id}: running → failed`);
      } catch { /* non-fatal */ }
    }
  }
}
