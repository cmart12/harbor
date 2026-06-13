import {
  createCanvasAgent,
  updateCanvasAgentStatus,
  createAgentSession as dbCreateAgentSession,
  updateAgentSessionStatus,
  updateAgentSessionId,
  updateAgentSessionYolo,
  getAgentSession,
  listAgentSessions,
  appendAgentChatEvent,
  listAgentChatEvents,
  clearAgentChatEvents,
} from '../database';
import type { AgentSession, AgentChatEvent, CanvasAgent } from '../../shared/types';
import type { AgentRecord } from './agent-registry';

export class AgentPersistence {
  createCanvasAgentRecord(data: CanvasAgent): void {
    createCanvasAgent(data);
  }

  createAgentSessionRecord(data: AgentSession): void {
    dbCreateAgentSession(data);
  }

  /** Write status to both canvas_agents and agent_sessions tables. No-op for ephemeral agents. */
  updateStatus(record: AgentRecord): void {
    if (record.ephemeral) return;
    try {
      updateCanvasAgentStatus(record.agentId, record.status);
    } catch { /* non-fatal */ }
    try {
      updateAgentSessionStatus(record.agentId, record.status, record.summary);
    } catch { /* non-fatal */ }
  }

  /** Write summary to agent_sessions table only. No-op for ephemeral agents. */
  persistSummary(record: AgentRecord): void {
    if (record.ephemeral) return;
    try {
      updateAgentSessionStatus(record.agentId, record.status, record.summary);
    } catch { /* non-fatal */ }
  }

  /** Persist the per-session yolo (auto-approve) flag. No-op for ephemeral agents. */
  updateYolo(record: AgentRecord, enabled: boolean): void {
    if (record.ephemeral) return;
    try {
      updateAgentSessionYolo(record.agentId, enabled);
    } catch { /* non-fatal */ }
  }

  getSession(agentId: string): AgentSession | null {
    return getAgentSession(agentId);
  }

  listSessions(): AgentSession[] {
    return listAgentSessions();
  }

  updateSessionStatus(agentId: string, status: string, summary: string): void {
    updateAgentSessionStatus(agentId, status, summary);
  }

  /** Update session_id in both agent_sessions and canvas_agents tables. */
  updateSessionId(agentId: string, newSessionId: string): void {
    updateAgentSessionId(agentId, newSessionId);
  }

  /**
   * Append a chat event to the persisted transcript for `agentId`.
   * No-op for ephemeral agents — they're explicitly not persisted.
   * Failures are swallowed (transcript is best-effort, not critical
   * path); they're logged for diagnosis.
   */
  appendChatEvent(
    record: AgentRecord,
    event: { event_id: string | null; type: string; timestamp: string; payload: string },
  ): void {
    if (record.ephemeral) return;
    try {
      appendAgentChatEvent(record.agentId, event);
    } catch (err) {
      console.warn(`[agent-persistence] appendChatEvent failed for ${record.agentId}: ${(err as Error).message}`);
    }
  }

  /** Read the persisted transcript for an agent, ordered oldest-first. */
  listChatEvents(agentId: string): AgentChatEvent[] {
    try {
      return listAgentChatEvents(agentId);
    } catch {
      return [];
    }
  }

  /** Discard persisted transcript for an agent. */
  clearChatEvents(agentId: string): void {
    try {
      clearAgentChatEvents(agentId);
    } catch { /* non-fatal */ }
  }
}
