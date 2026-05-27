import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentListAllItem } from '../../shared/ipc-contract';
import { agentStore } from './agent-store';
import type { AgentApproval, AgentStep, AgentPresence } from './agent-store';

function makeAgent(overrides: Partial<AgentListAllItem> & { agentId: string; spaceId: string }): AgentListAllItem {
  return {
    sessionId: 'sess-1',
    status: 'running',
    summary: 'Test agent',
    selectedText: '',
    anchor: { type: 'space' } as AgentListAllItem['anchor'],
    createdAt: '2024-01-01T00:00:00Z',
    pendingApprovalId: null,
    pendingPermissionKind: null,
    pendingIntention: null,
    pendingPath: null,
    source: 'sdk',
    ...overrides,
  };
}

describe('AgentStore', () => {
  beforeEach(() => {
    // Reset singleton state between tests
    agentStore.setAgents([]);
    agentStore.setActiveSessionIntents(new Set());
    // Clear collections that have no bulk-reset method
    for (const id of agentStore.getState().processingSpaces) {
      agentStore.removeProcessingIntent(id);
    }
    for (const id of agentStore.getState().approvals.keys()) {
      agentStore.clearApproval(id);
    }
    for (const id of agentStore.getState().presence.keys()) {
      agentStore.clearPresence(id);
    }
    for (const id of agentStore.getState().yoloMode.keys()) {
      agentStore.setYoloMode(id, false);
    }
    for (const id of agentStore.getState().remoteState.keys()) {
      agentStore.setRemoteState(id, null);
    }
    // Steps: overwrite with empty arrays, then set a fresh agents list to drop stale keys
    for (const id of agentStore.getState().steps.keys()) {
      agentStore.setSteps(id, []);
    }
  });

  // -- Initial state ----------------------------------------------------------

  it('has correct initial state after reset', () => {
    const state = agentStore.getState();
    expect(state.agents).toEqual([]);
    expect(state.processingSpaces.size).toBe(0);
    expect(state.activeSessionSpaces.size).toBe(0);
    expect(state.approvals.size).toBe(0);
    expect(state.steps.size).toBe(0);
    expect(state.presence.size).toBe(0);
    expect(state.yoloMode.size).toBe(0);
    expect(state.remoteState.size).toBe(0);
  });

  // -- setAgents() ------------------------------------------------------------

  it('setAgents() updates agents and notifies listeners', () => {
    const listener = vi.fn();
    const unsub = agentStore.subscribe(listener);

    const agents = [makeAgent({ agentId: 'a1', spaceId: 'i1' })];
    agentStore.setAgents(agents);

    expect(agentStore.getState().agents).toEqual(agents);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  // -- Processing spaces -----------------------------------------------------

  it('addProcessingIntent() / removeProcessingIntent() work correctly', () => {
    agentStore.addProcessingIntent('space-1');
    expect(agentStore.getState().processingSpaces.has('space-1')).toBe(true);

    agentStore.addProcessingIntent('space-2');
    expect(agentStore.getState().processingSpaces.size).toBe(2);

    agentStore.removeProcessingIntent('space-1');
    expect(agentStore.getState().processingSpaces.has('space-1')).toBe(false);
    expect(agentStore.getState().processingSpaces.has('space-2')).toBe(true);
  });

  it('removeProcessingIntent() is safe when id is not present', () => {
    agentStore.removeProcessingIntent('nonexistent');
    expect(agentStore.getState().processingSpaces.size).toBe(0);
  });

  // -- Active session spaces -------------------------------------------------

  it('setActiveSessionIntents() updates the set', () => {
    agentStore.setActiveSessionIntents(new Set(['i1', 'i2']));
    const state = agentStore.getState();
    expect(state.activeSessionSpaces.has('i1')).toBe(true);
    expect(state.activeSessionSpaces.has('i2')).toBe(true);
    expect(state.activeSessionSpaces.size).toBe(2);
  });

  // -- Approvals --------------------------------------------------------------

  it('setApproval() / clearApproval() manage the approvals map', () => {
    const approval: AgentApproval = {
      agentId: 'a1',
      requestId: 'req-1',
      permissionKind: 'file_write',
      intention: 'Update config',
      path: '/etc/config',
    };

    agentStore.setApproval('a1', approval);
    expect(agentStore.getState().approvals.get('a1')).toEqual(approval);

    agentStore.clearApproval('a1');
    expect(agentStore.getState().approvals.has('a1')).toBe(false);
  });

  it('clearApproval() is safe when agentId is not present', () => {
    agentStore.clearApproval('nonexistent');
    expect(agentStore.getState().approvals.size).toBe(0);
  });

  // -- Steps ------------------------------------------------------------------

  it('addStep() appends steps for an agent', () => {
    const step1: AgentStep = { toolCallId: 'tc1', label: 'Reading file', status: 'done' };
    const step2: AgentStep = { toolCallId: 'tc2', label: 'Writing file', status: 'running' };

    agentStore.addStep('a1', step1);
    expect(agentStore.getState().steps.get('a1')).toEqual([step1]);

    agentStore.addStep('a1', step2);
    expect(agentStore.getState().steps.get('a1')).toEqual([step1, step2]);
  });

  it('setSteps() replaces all steps for an agent', () => {
    const step1: AgentStep = { toolCallId: 'tc1', label: 'Old step', status: 'done' };
    agentStore.addStep('a1', step1);

    const newSteps: AgentStep[] = [
      { toolCallId: 'tc2', label: 'New step', status: 'running' },
    ];
    agentStore.setSteps('a1', newSteps);
    expect(agentStore.getState().steps.get('a1')).toEqual(newSteps);
  });

  // -- Presence ---------------------------------------------------------------

  it('setPresence() / clearPresence() manage the presence map', () => {
    const presence: AgentPresence = {
      agentId: 'a1',
      spaceId: 'i1',
      persona: { name: 'Agent Smith', handle: 'smith', color: '#ff0000' },
    };

    agentStore.setPresence('a1', presence);
    expect(agentStore.getState().presence.get('a1')).toEqual(presence);

    agentStore.clearPresence('a1');
    expect(agentStore.getState().presence.has('a1')).toBe(false);
  });

  it('clearPresence() is safe when agentId is not present', () => {
    agentStore.clearPresence('nonexistent');
    expect(agentStore.getState().presence.size).toBe(0);
  });

  // -- Yolo mode --------------------------------------------------------------

  it('setYoloMode(true) records the agent; setYoloMode(false) removes it', () => {
    agentStore.setYoloMode('a1', true);
    expect(agentStore.getState().yoloMode.get('a1')).toBe(true);

    agentStore.setYoloMode('a1', false);
    expect(agentStore.getState().yoloMode.has('a1')).toBe(false);
  });

  // -- Remote control ---------------------------------------------------------

  it('setRemoteState() with enabled=true records the agent', () => {
    agentStore.setRemoteState('a1', { enabled: true, url: 'https://x.example' });
    expect(agentStore.getState().remoteState.get('a1')).toEqual({ enabled: true, url: 'https://x.example' });
  });

  it('setRemoteState() with enabled=false removes the agent', () => {
    agentStore.setRemoteState('a1', { enabled: true, url: 'https://x.example' });
    agentStore.setRemoteState('a1', { enabled: false });
    expect(agentStore.getState().remoteState.has('a1')).toBe(false);
  });

  it('setRemoteState(null) removes the agent', () => {
    agentStore.setRemoteState('a1', { enabled: true });
    agentStore.setRemoteState('a1', null);
    expect(agentStore.getState().remoteState.has('a1')).toBe(false);
  });

  // -- Stale-fetch guards -----------------------------------------------------

  it('nextRequestId() returns monotonically increasing ids', () => {
    const id1 = agentStore.nextRequestId();
    const id2 = agentStore.nextRequestId();
    expect(id2).toBeGreaterThan(id1);
  });

  it('isCurrentRequest() recognizes only the latest reservation', () => {
    const stale = agentStore.nextRequestId();
    const fresh = agentStore.nextRequestId();

    expect(agentStore.isCurrentRequest(fresh)).toBe(true);
    expect(agentStore.isCurrentRequest(stale)).toBe(false);
  });

  // -- getAgentsBySpace() -----------------------------------------------------

  it('getAgentsBySpace() groups agents by space and skips workspace pseudo-space', () => {
    const a1 = makeAgent({ agentId: 'a1', spaceId: 'i1' });
    const a2 = makeAgent({ agentId: 'a2', spaceId: 'i1' });
    const a3 = makeAgent({ agentId: 'a3', spaceId: 'i2' });
    const a4 = makeAgent({ agentId: 'a4', spaceId: '__workspace__' });
    agentStore.setAgents([a1, a2, a3, a4]);

    const groups = agentStore.getAgentsBySpace();
    expect(groups.get('i1')).toEqual([a1, a2]);
    expect(groups.get('i2')).toEqual([a3]);
    expect(groups.has('__workspace__')).toBe(false);
  });

  // -- Subscribe / unsubscribe ------------------------------------------------

  it('subscribe() returns a working unsubscribe function', () => {
    const listener = vi.fn();
    const unsub = agentStore.subscribe(listener);

    agentStore.addProcessingIntent('i1');
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    agentStore.addProcessingIntent('i2');
    expect(listener).toHaveBeenCalledTimes(1); // not called again
  });

  it('multiple listeners are all notified', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = agentStore.subscribe(listener1);
    const unsub2 = agentStore.subscribe(listener2);

    agentStore.addProcessingIntent('i1');

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });

  // -- getAgentsForIntent() ---------------------------------------------------

  it('getAgentsForIntent() returns filtered agents', () => {
    const a1 = makeAgent({ agentId: 'a1', spaceId: 'i1' });
    const a2 = makeAgent({ agentId: 'a2', spaceId: 'i2' });
    const a3 = makeAgent({ agentId: 'a3', spaceId: 'i1' });
    agentStore.setAgents([a1, a2, a3]);

    expect(agentStore.getAgentsForIntent('i1')).toEqual([a1, a3]);
    expect(agentStore.getAgentsForIntent('i2')).toEqual([a2]);
    expect(agentStore.getAgentsForIntent('i99')).toEqual([]);
  });

  // -- hasActiveAgent() -------------------------------------------------------

  it('hasActiveAgent() returns true for running agent', () => {
    agentStore.setAgents([makeAgent({ agentId: 'a1', spaceId: 'i1', status: 'running' })]);
    expect(agentStore.hasActiveAgent('i1')).toBe(true);
  });

  it('hasActiveAgent() returns true for waiting-approval agent', () => {
    agentStore.setAgents([makeAgent({ agentId: 'a1', spaceId: 'i1', status: 'waiting-approval' })]);
    expect(agentStore.hasActiveAgent('i1')).toBe(true);
  });

  it('hasActiveAgent() returns false for completed agent', () => {
    agentStore.setAgents([makeAgent({ agentId: 'a1', spaceId: 'i1', status: 'completed' })]);
    expect(agentStore.hasActiveAgent('i1')).toBe(false);
  });

  it('hasActiveAgent() returns false for failed agent', () => {
    agentStore.setAgents([makeAgent({ agentId: 'a1', spaceId: 'i1', status: 'failed' })]);
    expect(agentStore.hasActiveAgent('i1')).toBe(false);
  });

  it('hasActiveAgent() returns false when no agents match space', () => {
    agentStore.setAgents([makeAgent({ agentId: 'a1', spaceId: 'other' })]);
    expect(agentStore.hasActiveAgent('i1')).toBe(false);
  });

  // -- State immutability (spread on mutation) --------------------------------

  it('mutations produce new state objects', () => {
    const state1 = agentStore.getState();
    agentStore.addProcessingIntent('i1');
    const state2 = agentStore.getState();

    expect(state1).not.toBe(state2);
    expect(state1.processingSpaces.has('i1')).toBe(false);
    expect(state2.processingSpaces.has('i1')).toBe(true);
  });
});
