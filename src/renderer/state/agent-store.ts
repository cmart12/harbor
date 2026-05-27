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
  spaceId: string;
  persona: { name: string; handle: string; color?: string; imageUrl?: string };
}

export interface AgentRemoteInfo {
  enabled: boolean;
  url?: string;
}

export interface AgentState {
  agents: AgentListAllItem[];
  processingSpaces: Set<string>;
  activeSessionSpaces: Set<string>;
  approvals: Map<string, AgentApproval>;
  steps: Map<string, AgentStep[]>;
  presence: Map<string, AgentPresence>;
  yoloMode: Map<string, boolean>;
  remoteState: Map<string, AgentRemoteInfo>;
}

type Listener = () => void;

class AgentStore {
  private state: AgentState = {
    agents: [],
    processingSpaces: new Set(),
    activeSessionSpaces: new Set(),
    approvals: new Map(),
    steps: new Map(),
    presence: new Map(),
    yoloMode: new Map(),
    remoteState: new Map(),
  };
  private listeners: Set<Listener> = new Set();
  /** Monotonic counter for stale-fetch detection (replaces app.ts:renderGeneration). */
  private requestCounter = 0;
  private latestRequestId = 0;

  getState(): Readonly<AgentState> {
    return this.state;
  }

  setAgents(agents: AgentListAllItem[]): void {
    this.state = { ...this.state, agents };
    this.notify();
  }

  // -- Processing spaces ----------------------------------------------------

  addProcessingIntent(spaceId: string): void {
    const next = new Set(this.state.processingSpaces);
    next.add(spaceId);
    this.state = { ...this.state, processingSpaces: next };
    this.notify();
  }

  removeProcessingIntent(spaceId: string): void {
    const next = new Set(this.state.processingSpaces);
    next.delete(spaceId);
    this.state = { ...this.state, processingSpaces: next };
    this.notify();
  }

  // -- Active sessions -------------------------------------------------------

  setActiveSessionIntents(spaceIds: Set<string>): void {
    this.state = { ...this.state, activeSessionSpaces: new Set(spaceIds) };
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

  // -- Yolo mode -------------------------------------------------------------

  setYoloMode(agentId: string, enabled: boolean): void {
    const next = new Map(this.state.yoloMode);
    if (enabled) {
      next.set(agentId, true);
    } else {
      next.delete(agentId);
    }
    this.state = { ...this.state, yoloMode: next };
    this.notify();
  }

  // -- Remote control --------------------------------------------------------

  setRemoteState(agentId: string, info: AgentRemoteInfo | null): void {
    const next = new Map(this.state.remoteState);
    if (info && info.enabled) {
      next.set(agentId, info);
    } else {
      next.delete(agentId);
    }
    this.state = { ...this.state, remoteState: next };
    this.notify();
  }

  // -- Stale-fetch guards (replaces app.ts:renderGeneration) -----------------

  /** Reserve a new request id. Latest reservation wins. */
  nextRequestId(): number {
    this.requestCounter += 1;
    this.latestRequestId = this.requestCounter;
    return this.latestRequestId;
  }

  /** True if the given id is still the latest reserved id. */
  isCurrentRequest(id: number): boolean {
    return id === this.latestRequestId;
  }

  /** Subscribe to state changes. Returns an unsubscribe function (useSyncExternalStore-compatible). */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -- Derived state helpers --------------------------------------------------

  getAgentsForIntent(spaceId: string): AgentListAllItem[] {
    return this.state.agents.filter(a => a.spaceId === spaceId);
  }

  hasActiveAgent(spaceId: string): boolean {
    return this.state.agents.some(
      a => a.spaceId === spaceId && (a.status === 'running' || a.status === 'waiting-approval'),
    );
  }

  /** Group agents by spaceId (skipping the workspace-level pseudo space). */
  getAgentsBySpace(): Map<string, AgentListAllItem[]> {
    const map = new Map<string, AgentListAllItem[]>();
    for (const agent of this.state.agents) {
      if (!agent.spaceId || agent.spaceId === '__workspace__') continue;
      const list = map.get(agent.spaceId);
      if (list) list.push(agent);
      else map.set(agent.spaceId, [agent]);
    }
    return map;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const agentStore = new AgentStore();
