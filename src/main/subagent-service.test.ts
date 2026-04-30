import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubagentTracker } from './subagent-service';

// Helper to create standard trackStarted data
function startData(overrides: Partial<Parameters<SubagentTracker['trackStarted']>[1]> = {}) {
  return {
    toolCallId: 'tc-1',
    agentName: 'explore',
    agentDisplayName: 'Explore Agent',
    agentDescription: 'An explore agent',
    ...overrides,
  };
}

describe('SubagentTracker', () => {
  let tracker: SubagentTracker;
  const PARENT = 'parent-1';

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new SubagentTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. trackStarted ──────────────────────────────────────────────

  describe('trackStarted', () => {
    it('creates agent with correct initial state', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      const agent = tracker.getSubagent(PARENT, 'a1');
      expect(agent).toBeDefined();
      expect(agent!.status).toBe('running');
      expect(agent!.turns).toEqual([]);
      expect(agent!.toolCalls).toEqual([]);
      expect(agent!.streamingContent).toBe('');
      expect(agent!.name).toBe('explore');
      expect(agent!.displayName).toBe('Explore Agent');
      expect(agent!.description).toBe('An explore agent');
      expect(agent!.agentType).toBe('explore');
      expect(agent!.progress).toEqual({
        toolCallsCompleted: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      });
    });

    it('auto-generates agentId from toolCallId when not provided', () => {
      tracker.trackStarted(PARENT, startData({ toolCallId: 'tc-42' }));
      const agent = tracker.getSubagent(PARENT, 'agent-tc-42');
      expect(agent).toBeDefined();
      expect(agent!.agentId).toBe('agent-tc-42');
    });

    it('registers in toolCallIndex for later resolution', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1', toolCallId: 'tc-99' }));
      const ref = tracker.getAgentIdForToolCall('tc-99');
      expect(ref).toEqual({ parentAgentId: PARENT, agentId: 'a1' });
    });

    it('supports multiple agents under the same parent', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1', toolCallId: 'tc-1' }));
      tracker.trackStarted(PARENT, startData({ agentId: 'a2', toolCallId: 'tc-2' }));
      const list = tracker.listSubagents(PARENT);
      expect(list).toHaveLength(2);
    });
  });

  // ── 2. trackCompleted ─────────────────────────────────────────────

  describe('trackCompleted', () => {
    it('sets status to completed with timing info', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      vi.advanceTimersByTime(100);
      tracker.trackCompleted(PARENT, { agentId: 'a1', toolCallId: 'tc-1' });
      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.status).toBe('completed');
      expect(agent.completedAt).toBeDefined();
      expect(agent.durationMs).toBeDefined();
    });

    it('finalizes streaming content into a turn', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackStreamingDelta(PARENT, 'a1', 'hello world');
      tracker.trackCompleted(PARENT, { agentId: 'a1', toolCallId: 'tc-1' });
      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.turns).toHaveLength(1);
      expect(agent.turns[0].response).toBe('hello world');
      expect(agent.streamingContent).toBe('');
    });

    it('resolves agentId from toolCallId when agentId not provided', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1', toolCallId: 'tc-1' }));
      tracker.trackCompleted(PARENT, { toolCallId: 'tc-1' });
      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.status).toBe('completed');
    });

    it('is no-op for unknown agents', () => {
      // Should not throw
      tracker.trackCompleted(PARENT, { agentId: 'nonexistent', toolCallId: 'tc-x' });
      expect(tracker.listSubagents(PARENT)).toHaveLength(0);
    });

    it('records optional metadata', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackCompleted(PARENT, {
        agentId: 'a1',
        toolCallId: 'tc-1',
        model: 'gpt-4',
        totalTokens: 5000,
        totalToolCalls: 12,
        durationMs: 999,
        agentDisplayName: 'Updated Name',
      });
      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.model).toBe('gpt-4');
      expect(agent.totalTokens).toBe(5000);
      expect(agent.totalToolCalls).toBe(12);
      expect(agent.durationMs).toBe(999);
      expect(agent.displayName).toBe('Updated Name');
    });
  });

  // ── 3. trackFailed ────────────────────────────────────────────────

  describe('trackFailed', () => {
    it('sets status to failed with error message', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackFailed(PARENT, { agentId: 'a1', toolCallId: 'tc-1', error: 'boom' });
      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.status).toBe('failed');
      expect(agent.error).toBe('boom');
      expect(agent.completedAt).toBeDefined();
    });

    it('finalizes streaming content into a turn', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackStreamingDelta(PARENT, 'a1', 'partial output');
      tracker.trackFailed(PARENT, { agentId: 'a1', toolCallId: 'tc-1', error: 'crash' });
      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.turns).toHaveLength(1);
      expect(agent.turns[0].response).toBe('partial output');
      expect(agent.streamingContent).toBe('');
    });

    it('records optional metadata (model, totalTokens, totalToolCalls)', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackFailed(PARENT, {
        agentId: 'a1',
        toolCallId: 'tc-1',
        error: 'err',
        model: 'claude-3',
        totalTokens: 3000,
        totalToolCalls: 5,
      });
      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.model).toBe('claude-3');
      expect(agent.totalTokens).toBe(3000);
      expect(agent.totalToolCalls).toBe(5);
    });

    it('resolves agentId from toolCallId', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1', toolCallId: 'tc-1' }));
      tracker.trackFailed(PARENT, { toolCallId: 'tc-1', error: 'fail' });
      expect(tracker.getSubagent(PARENT, 'a1')!.status).toBe('failed');
    });
  });

  // ── 4. trackStreamingDelta ────────────────────────────────────────

  describe('trackStreamingDelta', () => {
    it('appends delta to streamingContent', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackStreamingDelta(PARENT, 'a1', 'hello ');
      tracker.trackStreamingDelta(PARENT, 'a1', 'world');
      expect(tracker.getSubagent(PARENT, 'a1')!.streamingContent).toBe('hello world');
    });

    it('truncates at MAX_STREAMING_CONTENT (100,000 chars)', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      const bigChunk = 'x'.repeat(100_000);
      tracker.trackStreamingDelta(PARENT, 'a1', bigChunk);
      // Now at limit — further deltas should be ignored
      tracker.trackStreamingDelta(PARENT, 'a1', 'extra');
      expect(tracker.getSubagent(PARENT, 'a1')!.streamingContent.length).toBe(100_000);
    });

    it('is no-op for unknown agents', () => {
      // Should not throw
      tracker.trackStreamingDelta(PARENT, 'nonexistent', 'data');
    });
  });

  // ── 5. trackTurnStart ─────────────────────────────────────────────

  describe('trackTurnStart', () => {
    it('finalizes current streaming content as a completed turn', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackStreamingDelta(PARENT, 'a1', 'turn 0 content');
      tracker.trackTurnStart(PARENT, 'a1');
      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.turns).toHaveLength(1);
      expect(agent.turns[0].response).toBe('turn 0 content');
      expect(agent.turns[0].turnIndex).toBe(0);
      expect(agent.streamingContent).toBe('');
    });

    it('does nothing when streamingContent is empty', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackTurnStart(PARENT, 'a1');
      expect(tracker.getSubagent(PARENT, 'a1')!.turns).toHaveLength(0);
    });

    it('increments turn index across multiple turns', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackStreamingDelta(PARENT, 'a1', 'turn-0');
      tracker.trackTurnStart(PARENT, 'a1');
      tracker.trackStreamingDelta(PARENT, 'a1', 'turn-1');
      tracker.trackTurnStart(PARENT, 'a1');
      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.turns).toHaveLength(2);
      expect(agent.turns[0].turnIndex).toBe(0);
      expect(agent.turns[1].turnIndex).toBe(1);
    });
  });

  // ── 6. Turn limits — MAX_TURNS_PER_AGENT (50) ────────────────────

  describe('turn limits', () => {
    it('shifts oldest turn when exceeding MAX_TURNS_PER_AGENT', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      // Create 50 turns (the limit)
      for (let i = 0; i < 50; i++) {
        tracker.trackStreamingDelta(PARENT, 'a1', `turn-${i}`);
        tracker.trackTurnStart(PARENT, 'a1');
      }
      expect(tracker.getSubagent(PARENT, 'a1')!.turns).toHaveLength(50);

      // 51st turn should evict the first
      tracker.trackStreamingDelta(PARENT, 'a1', 'turn-50');
      tracker.trackTurnStart(PARENT, 'a1');
      const turns = tracker.getSubagent(PARENT, 'a1')!.turns;
      expect(turns).toHaveLength(50);
      expect(turns[0].response).toBe('turn-1');
      expect(turns[turns.length - 1].response).toBe('turn-50');
    });
  });

  // ── 7. Tool tracking ─────────────────────────────────────────────

  describe('trackToolStart / trackToolComplete', () => {
    it('adds tool call entry on start', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackToolStart(PARENT, 'a1', {
        toolCallId: 'tool-1',
        toolName: 'bash',
        args: { command: 'ls' },
      });
      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.toolCalls).toHaveLength(1);
      expect(agent.toolCalls[0].toolName).toBe('bash');
      expect(agent.toolCalls[0].completed).toBe(false);
    });

    it('marks tool as completed with success on complete', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackToolStart(PARENT, 'a1', {
        toolCallId: 'tool-1',
        toolName: 'bash',
        args: {},
      });
      tracker.trackToolComplete(PARENT, 'a1', {
        toolCallId: 'tool-1',
        success: true,
        result: 'output',
      });
      const tc = tracker.getSubagent(PARENT, 'a1')!.toolCalls[0];
      expect(tc.completed).toBe(true);
      expect(tc.success).toBe(true);
      expect(tc.result).toBe('output');
    });

    it('marks tool as completed with error on failure', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackToolStart(PARENT, 'a1', {
        toolCallId: 'tool-1',
        toolName: 'bash',
        args: {},
      });
      tracker.trackToolComplete(PARENT, 'a1', {
        toolCallId: 'tool-1',
        success: false,
        error: 'command not found',
      });
      const tc = tracker.getSubagent(PARENT, 'a1')!.toolCalls[0];
      expect(tc.completed).toBe(true);
      expect(tc.success).toBe(false);
      expect(tc.error).toBe('command not found');
    });

    it('increments toolCallsCompleted in progress', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackToolStart(PARENT, 'a1', { toolCallId: 't1', toolName: 'bash', args: {} });
      tracker.trackToolComplete(PARENT, 'a1', { toolCallId: 't1', success: true });
      tracker.trackToolStart(PARENT, 'a1', { toolCallId: 't2', toolName: 'grep', args: {} });
      tracker.trackToolComplete(PARENT, 'a1', { toolCallId: 't2', success: true });
      expect(tracker.getSubagent(PARENT, 'a1')!.progress.toolCallsCompleted).toBe(2);
    });

    it('enforces MAX_TOOL_CALLS_PER_AGENT (200) with FIFO eviction', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      for (let i = 0; i < 200; i++) {
        tracker.trackToolStart(PARENT, 'a1', {
          toolCallId: `t-${i}`,
          toolName: 'bash',
          args: {},
        });
      }
      expect(tracker.getSubagent(PARENT, 'a1')!.toolCalls).toHaveLength(200);

      // 201st should evict the first
      tracker.trackToolStart(PARENT, 'a1', {
        toolCallId: 't-200',
        toolName: 'bash',
        args: {},
      });
      const calls = tracker.getSubagent(PARENT, 'a1')!.toolCalls;
      expect(calls).toHaveLength(200);
      expect(calls[0].toolCallId).toBe('t-1');
      expect(calls[calls.length - 1].toolCallId).toBe('t-200');
    });
  });

  // ── 8. Usage tracking ────────────────────────────────────────────

  describe('trackUsage', () => {
    it('accumulates input and output tokens', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackUsage(PARENT, 'a1', 100, 50);
      tracker.trackUsage(PARENT, 'a1', 200, 75);
      const progress = tracker.getSubagent(PARENT, 'a1')!.progress;
      expect(progress.totalInputTokens).toBe(300);
      expect(progress.totalOutputTokens).toBe(125);
    });
  });

  describe('trackModel', () => {
    it('sets the model field and resolvedModel in progress', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackModel(PARENT, 'a1', 'claude-sonnet-4');
      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.model).toBe('claude-sonnet-4');
      expect(agent.progress.resolvedModel).toBe('claude-sonnet-4');
    });
  });

  // ── 9. Space tracking ───────────────────────────────────────────

  describe('trackIntent', () => {
    it('sets progress.currentIntent', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackIntent(PARENT, 'a1', 'Exploring codebase');
      expect(tracker.getSubagent(PARENT, 'a1')!.progress.currentIntent).toBe('Exploring codebase');
    });
  });

  // ── 10. trackIdle ────────────────────────────────────────────────

  describe('trackIdle', () => {
    it('sets status to idle and finalizes turn', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackStreamingDelta(PARENT, 'a1', 'some content');
      tracker.trackIdle(PARENT, 'a1');
      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.status).toBe('idle');
      expect(agent.turns).toHaveLength(1);
      expect(agent.streamingContent).toBe('');
    });

    it('is no-op if agent is not running', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackCompleted(PARENT, { agentId: 'a1', toolCallId: 'tc-1' });
      // Agent is now 'completed', trackIdle should do nothing
      tracker.trackIdle(PARENT, 'a1');
      expect(tracker.getSubagent(PARENT, 'a1')!.status).toBe('completed');
    });

    it('notifies change listeners', () => {
      const listener = vi.fn();
      tracker.onChange(listener);
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      vi.advanceTimersByTime(500); // flush trackStarted notification

      tracker.trackIdle(PARENT, 'a1');
      vi.advanceTimersByTime(500);
      expect(listener).toHaveBeenCalledWith(PARENT);
    });
  });

  // ── 11. Queries ──────────────────────────────────────────────────

  describe('queries', () => {
    it('listSubagents returns summaries without turns/toolCalls/streamingContent', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackStreamingDelta(PARENT, 'a1', 'content');
      const summaries = tracker.listSubagents(PARENT);
      expect(summaries).toHaveLength(1);
      const summary = summaries[0];
      expect(summary.agentId).toBe('a1');
      expect(summary.status).toBe('running');
      // Summaries should not have turns, toolCalls, or streamingContent
      expect((summary as any).turns).toBeUndefined();
      expect((summary as any).toolCalls).toBeUndefined();
      expect((summary as any).streamingContent).toBeUndefined();
    });

    it('listSubagents returns empty array for unknown parent', () => {
      expect(tracker.listSubagents('nonexistent')).toEqual([]);
    });

    it('getSubagent returns full info', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      const agent = tracker.getSubagent(PARENT, 'a1');
      expect(agent).toBeDefined();
      expect(agent!.turns).toBeDefined();
      expect(agent!.toolCalls).toBeDefined();
      expect(agent!.streamingContent).toBeDefined();
    });

    it('getSubagent returns undefined for unknown agent', () => {
      expect(tracker.getSubagent(PARENT, 'nonexistent')).toBeUndefined();
    });

    it('getAgentIdForToolCall returns correct mapping', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1', toolCallId: 'tc-1' }));
      expect(tracker.getAgentIdForToolCall('tc-1')).toEqual({
        parentAgentId: PARENT,
        agentId: 'a1',
      });
    });

    it('getAgentIdForToolCall returns undefined for unknown toolCallId', () => {
      expect(tracker.getAgentIdForToolCall('unknown')).toBeUndefined();
    });
  });

  // ── 12. onChange notification ─────────────────────────────────────

  describe('onChange notification', () => {
    it('calls listeners after throttle delay (500ms)', () => {
      const listener = vi.fn();
      tracker.onChange(listener);
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      // Listener should not be called yet (throttled)
      expect(listener).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(PARENT);
    });

    it('throttles multiple rapid notifications to one per 500ms', () => {
      const listener = vi.fn();
      tracker.onChange(listener);
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackIntent(PARENT, 'a1', 'doing stuff');
      // Both events should coalesce into one notification
      vi.advanceTimersByTime(500);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe function works', () => {
      const listener = vi.fn();
      const unsub = tracker.onChange(listener);
      unsub();
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      vi.advanceTimersByTime(500);
      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      tracker.onChange(listener1);
      tracker.onChange(listener2);
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      vi.advanceTimersByTime(500);
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('fires separately for different parents', () => {
      const listener = vi.fn();
      tracker.onChange(listener);
      tracker.trackStarted('parent-A', startData({ agentId: 'a1', toolCallId: 'tc-a' }));
      tracker.trackStarted('parent-B', startData({ agentId: 'b1', toolCallId: 'tc-b' }));
      vi.advanceTimersByTime(500);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith('parent-A');
      expect(listener).toHaveBeenCalledWith('parent-B');
    });
  });

  // ── 13. pruneCompleted ───────────────────────────────────────────

  describe('pruneCompleted', () => {
    it('removes completed agents older than maxAge', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackCompleted(PARENT, { agentId: 'a1', toolCallId: 'tc-1' });

      // Advance past default maxAge (10 minutes)
      vi.advanceTimersByTime(11 * 60 * 1000);

      tracker.pruneCompleted(PARENT);
      expect(tracker.getSubagent(PARENT, 'a1')).toBeUndefined();
      expect(tracker.listSubagents(PARENT)).toHaveLength(0);
    });

    it('removes failed agents older than maxAge', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackFailed(PARENT, { agentId: 'a1', toolCallId: 'tc-1', error: 'err' });

      vi.advanceTimersByTime(11 * 60 * 1000);
      tracker.pruneCompleted(PARENT);
      expect(tracker.getSubagent(PARENT, 'a1')).toBeUndefined();
    });

    it('does not touch running agents', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));

      vi.advanceTimersByTime(11 * 60 * 1000);
      tracker.pruneCompleted(PARENT);
      expect(tracker.getSubagent(PARENT, 'a1')).toBeDefined();
      expect(tracker.getSubagent(PARENT, 'a1')!.status).toBe('running');
    });

    it('respects custom maxAge parameter', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackCompleted(PARENT, { agentId: 'a1', toolCallId: 'tc-1' });

      // Use a short maxAge of 1 second
      vi.advanceTimersByTime(2000);
      tracker.pruneCompleted(PARENT, 1000);
      expect(tracker.getSubagent(PARENT, 'a1')).toBeUndefined();
    });

    it('does not prune recently completed agents', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      tracker.trackCompleted(PARENT, { agentId: 'a1', toolCallId: 'tc-1' });

      // Only 1 second passed, default maxAge is 10 minutes
      vi.advanceTimersByTime(1000);
      tracker.pruneCompleted(PARENT);
      expect(tracker.getSubagent(PARENT, 'a1')).toBeDefined();
    });

    it('cleans up toolCallIndex entries', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1', toolCallId: 'tc-1' }));
      tracker.trackCompleted(PARENT, { agentId: 'a1', toolCallId: 'tc-1' });

      vi.advanceTimersByTime(11 * 60 * 1000);
      tracker.pruneCompleted(PARENT);
      expect(tracker.getAgentIdForToolCall('tc-1')).toBeUndefined();
    });

    it('is no-op for unknown parent', () => {
      // Should not throw
      tracker.pruneCompleted('nonexistent');
    });
  });

  // ── 14. clearParent ──────────────────────────────────────────────

  describe('clearParent', () => {
    it('removes all agents for a parent', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1', toolCallId: 'tc-1' }));
      tracker.trackStarted(PARENT, startData({ agentId: 'a2', toolCallId: 'tc-2' }));
      tracker.clearParent(PARENT);
      expect(tracker.listSubagents(PARENT)).toEqual([]);
    });

    it('cleans up toolCallIndex entries', () => {
      tracker.trackStarted(PARENT, startData({ agentId: 'a1', toolCallId: 'tc-1' }));
      tracker.clearParent(PARENT);
      expect(tracker.getAgentIdForToolCall('tc-1')).toBeUndefined();
    });

    it('clears pending throttle timers (no leak)', () => {
      const listener = vi.fn();
      tracker.onChange(listener);
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));
      // There's now a pending throttle timer for PARENT
      tracker.clearParent(PARENT);
      vi.advanceTimersByTime(500);
      // Listener should NOT be called because the timer was cleared
      expect(listener).not.toHaveBeenCalled();
    });

    it('is no-op for unknown parent', () => {
      // Should not throw
      tracker.clearParent('nonexistent');
    });
  });

  // ── Integration: full agent lifecycle ────────────────────────────

  describe('full lifecycle integration', () => {
    it('tracks an agent from start through streaming, tools, and completion', () => {
      // Start
      tracker.trackStarted(PARENT, startData({ agentId: 'a1' }));

      // Model & space
      tracker.trackModel(PARENT, 'a1', 'claude-sonnet-4');
      tracker.trackIntent(PARENT, 'a1', 'Analyzing code');

      // First turn — streaming
      tracker.trackStreamingDelta(PARENT, 'a1', 'Let me look at ');
      tracker.trackStreamingDelta(PARENT, 'a1', 'the code...');

      // Tool call
      tracker.trackToolStart(PARENT, 'a1', {
        toolCallId: 'tool-1',
        toolName: 'grep',
        args: { pattern: 'foo' },
      });
      tracker.trackToolComplete(PARENT, 'a1', {
        toolCallId: 'tool-1',
        success: true,
        result: 'found 3 matches',
      });

      // New turn starts
      tracker.trackTurnStart(PARENT, 'a1');
      tracker.trackStreamingDelta(PARENT, 'a1', 'Found it!');

      // Usage
      tracker.trackUsage(PARENT, 'a1', 500, 200);

      // Complete
      tracker.trackCompleted(PARENT, { agentId: 'a1', toolCallId: 'tc-1' });

      const agent = tracker.getSubagent(PARENT, 'a1')!;
      expect(agent.status).toBe('completed');
      expect(agent.model).toBe('claude-sonnet-4');
      expect(agent.turns).toHaveLength(2);
      expect(agent.turns[0].response).toBe('Let me look at the code...');
      expect(agent.turns[1].response).toBe('Found it!');
      expect(agent.toolCalls).toHaveLength(1);
      expect(agent.toolCalls[0].success).toBe(true);
      expect(agent.progress.totalInputTokens).toBe(500);
      expect(agent.progress.totalOutputTokens).toBe(200);
      expect(agent.progress.toolCallsCompleted).toBe(1);
      expect(agent.progress.currentIntent).toBe('Analyzing code');
      expect(agent.progress.resolvedModel).toBe('claude-sonnet-4');
    });
  });
});
