import { AgentAnchor, AgentSession } from '../shared/types';
import { SubagentTracker } from './subagent-service';
import { AgentRegistry } from './agents/agent-registry';
import { AgentNotifier } from './agents/agent-notifier';
import { AgentPersistence } from './agents/agent-persistence';
import { InteractionBroker } from './agents/interaction-broker';

// Import runner modules
import { initSdkRunner, setupAgentEventListeners } from './agents/sdk-runner';
import { initCliRunner } from './agents/cli-runner';
import { initCommentWorkflow } from './agents/comment-workflow';

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

// ── Re-exports from SDK runner ─────────────────────────
export { buildCliToolsPrompt, launchAgent, launchQuickAgent, launchDocumentAgent, sendChatMessage, setAgentModel, getAgentHistory } from './agents/sdk-runner';

// ── Re-exports from CLI runner ─────────────────────────
export { launchCliSession, startCliExitMonitor, stopCliExitMonitor, openAgentCli } from './agents/cli-runner';

// ── Re-exports from comment workflow ───────────────────
export { launchCommentAgent } from './agents/comment-workflow';

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

export function listAgents(intentId: string): Array<{ agentId: string; sessionId: string; status: import('./agents/agent-registry').AgentStatus; summary: string; selectedText: string; anchor: AgentAnchor }> {
  return Array.from(registry.values())
    .filter(a => a.intentId === intentId)
    .map(a => ({
      agentId: a.agentId,
      sessionId: a.sessionId,
      status: a.status,
      summary: a.summary,
      selectedText: a.selectedText,
      anchor: a.anchor,
    }));
}

export function getAgentSessionId(agentId: string): string | null {
  return registry.get(agentId)?.sessionId ?? null;
}

export function listAllAgents(): Array<{ agentId: string; sessionId: string; status: import('./agents/agent-registry').AgentStatus; summary: string; selectedText: string; intentId: string; createdAt: string; pendingApprovalId: string | null; pendingPermissionKind: string | null; pendingIntention: string | null; pendingPath: string | null; source: 'sdk' | 'cli' | 'cloud' }> {
  // Read persisted sessions from DB (sorted newest first)
  let persisted: AgentSession[] = [];
  try {
    persisted = persistence.listSessions();
  } catch { /* DB may not be initialized */ }

  // Build result: overlay live in-memory state on top of DB records
  const seen = new Set<string>();
  const result: Array<{ agentId: string; sessionId: string; status: import('./agents/agent-registry').AgentStatus; summary: string; selectedText: string; intentId: string; createdAt: string; pendingApprovalId: string | null; pendingPermissionKind: string | null; pendingIntention: string | null; pendingPath: string | null; source: 'sdk' | 'cli' | 'cloud' }> = [];

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
      intentId: live?.intentId ?? row.intent_id ?? '__workspace__',
      createdAt: row.created_at,
      pendingApprovalId: live?.pendingApprovalId ?? null,
      pendingPermissionKind: live?.pendingPermissionKind ?? null,
      pendingIntention: pendingApproval?.intention ?? null,
      pendingPath: pendingApproval?.path ?? null,
      source: row.source ?? 'sdk',
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
        intentId: a.intentId,
        createdAt: '',
        pendingApprovalId: a.pendingApprovalId,
        pendingPermissionKind: a.pendingPermissionKind ?? null,
        pendingIntention: pendingApproval?.intention ?? null,
        pendingPath: pendingApproval?.path ?? null,
        source: 'sdk',
      });
    }
  }

  return result;
}
