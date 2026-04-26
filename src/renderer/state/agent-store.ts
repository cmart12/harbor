import type { AgentListAllItem } from '../../shared/ipc-contract';

export interface AgentApproval {
  agentId: string;
  requestId: string;
  permissionKind: string;
  intention?: string;
  path?: string;
}

export interface AgentStep {
  toolCallId: string;
  label: string;
  status: 'running' | 'done' | 'failed';
}

export interface AgentPresence {
  agentId: string;
  intentId: string;
  persona: { name: string; handle: string; color?: string; imageUrl?: string };
}

export interface AgentState {
  agents: AgentListAllItem[];
  processingIntents: Set<string>;
  activeSessionIntents: Set<string>;
  approvals: Map<string, AgentApproval>;
  steps: Map<string, AgentStep[]>;
  presence: Map<string, AgentPresence>;
}

type Listener = () => void;

class AgentStore {
  private state: AgentState = {
    agents: [],
    processingIntents: new Set(),
    activeSessionIntents: new Set(),
    approvals: new Map(),
    steps: new Map(),
    presence: new Map(),
  };
  private listeners: Set<Listener> = new Set();

  getState(): Readonly<AgentState> {
    return this.state;
  }

  setAgents(agents: AgentListAllItem[]): void {
    this.state = { ...this.state, agents };
    this.notify();
  }

  // -- Processing intents ----------------------------------------------------

  addProcessingIntent(intentId: string): void {
    const next = new Set(this.state.processingIntents);
    next.add(intentId);
    this.state = { ...this.state, processingIntents: next };
    this.notify();
  }

  removeProcessingIntent(intentId: string): void {
    const next = new Set(this.state.processingIntents);
    next.delete(intentId);
    this.state = { ...this.state, processingIntents: next };
    this.notify();
  }

  // -- Active sessions -------------------------------------------------------

  setActiveSessionIntents(intentIds: Set<string>): void {
    this.state = { ...this.state, activeSessionIntents: new Set(intentIds) };
    this.notify();
  }

  // -- Approvals -------------------------------------------------------------

  setApproval(agentId: string, approval: AgentApproval): void {
    const next = new Map(this.state.approvals);
    next.set(agentId, approval);
    this.state = { ...this.state, approvals: next };
    this.notify();
  }

  clearApproval(agentId: string): void {
    const next = new Map(this.state.approvals);
    next.delete(agentId);
    this.state = { ...this.state, approvals: next };
    this.notify();
  }

  // -- Steps -----------------------------------------------------------------

  addStep(agentId: string, step: AgentStep): void {
    const next = new Map(this.state.steps);
    const existing = next.get(agentId) ?? [];
    next.set(agentId, [...existing, step]);
    this.state = { ...this.state, steps: next };
    this.notify();
  }

  setSteps(agentId: string, steps: AgentStep[]): void {
    const next = new Map(this.state.steps);
    next.set(agentId, steps);
    this.state = { ...this.state, steps: next };
    this.notify();
  }

  // -- Presence --------------------------------------------------------------

  setPresence(agentId: string, presence: AgentPresence): void {
    const next = new Map(this.state.presence);
    next.set(agentId, presence);
    this.state = { ...this.state, presence: next };
    this.notify();
  }

  clearPresence(agentId: string): void {
    const next = new Map(this.state.presence);
    next.delete(agentId);
    this.state = { ...this.state, presence: next };
    this.notify();
  }

  /** Subscribe to state changes. Returns an unsubscribe function (useSyncExternalStore-compatible). */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -- Derived state helpers --------------------------------------------------

  getAgentsForIntent(intentId: string): AgentListAllItem[] {
    return this.state.agents.filter(a => a.intentId === intentId);
  }

  hasActiveAgent(intentId: string): boolean {
    return this.state.agents.some(
      a => a.intentId === intentId && (a.status === 'running' || a.status === 'waiting-approval'),
    );
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const agentStore = new AgentStore();
