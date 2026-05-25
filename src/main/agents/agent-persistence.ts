import {
  createCanvasAgent,
  updateCanvasAgentStatus,
  createAgentSession as dbCreateAgentSession,
  updateAgentSessionStatus,
  updateAgentSessionId,
  getAgentSession,
  listAgentSessions,
} from '../database';
import type { AgentSession, CanvasAgent } from '../../shared/types';
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
}
