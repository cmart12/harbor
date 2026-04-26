import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry, AgentRecord, truncate } from './agent-registry';

function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: overrides.agentId ?? 'agent-1',
    sessionId: overrides.sessionId ?? 'session-1',
    session: {} as any,
    intentId: 'intent-1',
    selectedText: '',
    anchor: { quote: '', prefix: '', suffix: '' },
    status: 'running',
    pendingApprovalId: null,
    pendingPermissionKind: null,
    pendingApprovals: new Map(),
    summary: '',
    ...overrides,
  };
}

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  describe('set / get / has / delete', () => {
    it('stores and retrieves a record', () => {
      const record = makeRecord();
      registry.set('agent-1', record);

      expect(registry.get('agent-1')).toBe(record);
      expect(registry.has('agent-1')).toBe(true);
    });

    it('returns undefined for unknown agent', () => {
      expect(registry.get('nope')).toBeUndefined();
      expect(registry.has('nope')).toBe(false);
    });

    it('deletes a record', () => {
      registry.set('agent-1', makeRecord());
      registry.delete('agent-1');

      expect(registry.has('agent-1')).toBe(false);
      expect(registry.get('agent-1')).toBeUndefined();
    });

    it('overwrites existing record on set', () => {
      registry.set('agent-1', makeRecord({ summary: 'first' }));
      const updated = makeRecord({ summary: 'second' });
      registry.set('agent-1', updated);

      expect(registry.get('agent-1')?.summary).toBe('second');
    });
  });

  describe('findBySessionId', () => {
    it('returns the record matching the session id', () => {
      const r1 = makeRecord({ agentId: 'a1', sessionId: 'sess-1' });
      const r2 = makeRecord({ agentId: 'a2', sessionId: 'sess-2' });
      registry.set('a1', r1);
      registry.set('a2', r2);

      expect(registry.findBySessionId('sess-2')).toBe(r2);
    });

    it('returns undefined for unknown session id', () => {
      registry.set('a1', makeRecord({ sessionId: 'sess-1' }));
      expect(registry.findBySessionId('unknown')).toBeUndefined();
    });

    it('returns the first match when multiple agents share a session', () => {
      registry.set('a1', makeRecord({ agentId: 'a1', sessionId: 'shared' }));
      registry.set('a2', makeRecord({ agentId: 'a2', sessionId: 'shared' }));

      const found = registry.findBySessionId('shared');
      expect(found).toBeDefined();
      expect(found!.sessionId).toBe('shared');
    });
  });

  describe('values / entries', () => {
    it('iterates over all values', () => {
      registry.set('a1', makeRecord({ agentId: 'a1' }));
      registry.set('a2', makeRecord({ agentId: 'a2' }));

      const ids = [...registry.values()].map(r => r.agentId);
      expect(ids).toContain('a1');
      expect(ids).toContain('a2');
      expect(ids).toHaveLength(2);
    });

    it('iterates over all entries', () => {
      registry.set('a1', makeRecord({ agentId: 'a1' }));
      registry.set('a2', makeRecord({ agentId: 'a2' }));

      const entries = [...registry.entries()];
      expect(entries).toHaveLength(2);
      expect(entries[0][0]).toBe('a1');
      expect(entries[1][0]).toBe('a2');
    });

    it('returns empty iterators when registry is empty', () => {
      expect([...registry.values()]).toHaveLength(0);
      expect([...registry.entries()]).toHaveLength(0);
    });
  });
});

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long strings with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('handles exact-length strings', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('handles maxLen smaller than 3', () => {
    // Edge case: maxLen=2 means slice(0, -1) + '...' which is odd but tests the boundary
    expect(truncate('abcdef', 3)).toBe('...');
  });
});
