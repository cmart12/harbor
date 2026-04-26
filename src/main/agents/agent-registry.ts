import type { CopilotSession } from '@github/copilot-sdk';
import type { AgentAnchor } from '../../shared/types';

export type AgentStatus = 'running' | 'waiting-approval' | 'completed' | 'failed';

export interface CommentAgentContext {
  threadIndex: number;
  personaHandle: string;
  personaName: string;
  commentBody: string;
  quotedText: string;
  anchor: { prefix?: string; suffix?: string };
  canvasHashBefore: string;
  canvasPath: string;
}

export interface AgentRecord {
  agentId: string;
  sessionId: string;
  session: CopilotSession;
  intentId: string;
  selectedText: string;
  anchor: AgentAnchor;
  status: AgentStatus;
  pendingApprovalId: string | null;
  pendingPermissionKind: string | null;
  pendingApprovals: Map<string, { permissionKind: string | null; intention?: string; path?: string }>;
  summary: string;
  commentContext?: CommentAgentContext;
}

export class AgentRegistry {
  private agents = new Map<string, AgentRecord>();

  set(agentId: string, record: AgentRecord): void {
    this.agents.set(agentId, record);
  }

  get(agentId: string): AgentRecord | undefined {
    return this.agents.get(agentId);
  }

  delete(agentId: string): void {
    this.agents.delete(agentId);
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  findBySessionId(sessionId: string): AgentRecord | undefined {
    for (const record of this.agents.values()) {
      if (record.sessionId === sessionId) return record;
    }
    return undefined;
  }

  values(): IterableIterator<AgentRecord> {
    return this.agents.values();
  }

  entries(): IterableIterator<[string, AgentRecord]> {
    return this.agents.entries();
  }
}

export function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
}
