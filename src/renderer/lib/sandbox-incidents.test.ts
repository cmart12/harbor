import { describe, it, expect } from 'vitest';
import {
  aggregateSandboxBlocks,
  planIncidentResolve,
  truncateCommandPreview,
  type IncidentInputBlock,
} from './sandbox-incidents';

function makeBlock(overrides: Partial<IncidentInputBlock>): IncidentInputBlock {
  return {
    agentId: 'a1',
    requestId: 'req-1',
    source: 'post-tool-shell',
    kind: 'shell',
    target: 'echo hi > /tmp/blocked.txt',
    toolName: 'bash',
    layer: 'mxc:shell-denial-high',
    ...overrides,
  };
}

describe('aggregateSandboxBlocks', () => {
  it('collapses two identical post-tool-shell blocks into one incident', () => {
    const blocks = [
      makeBlock({ requestId: 'r1' }),
      makeBlock({ requestId: 'r2' }),
    ];
    const incidents = aggregateSandboxBlocks(blocks);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].count).toBe(2);
    expect(incidents[0].requestIds).toEqual(['r1', 'r2']);
    expect(incidents[0].sample.requestId).toBe('r1');
  });

  it('keeps two distinct commands as separate incidents', () => {
    const blocks = [
      makeBlock({ requestId: 'r1', target: 'echo a > /tmp/x' }),
      makeBlock({ requestId: 'r2', target: 'curl example.com' }),
    ];
    const incidents = aggregateSandboxBlocks(blocks);
    expect(incidents).toHaveLength(2);
    expect(incidents[0].requestIds).toEqual(['r1']);
    expect(incidents[1].requestIds).toEqual(['r2']);
  });

  it('normalizes whitespace differences in target before keying', () => {
    const blocks = [
      makeBlock({ requestId: 'r1', target: 'echo  hi   > /tmp/blocked.txt' }),
      makeBlock({ requestId: 'r2', target: ' echo hi > /tmp/blocked.txt ' }),
    ];
    const incidents = aggregateSandboxBlocks(blocks);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].count).toBe(2);
  });

  it('does NOT collapse when layer differs', () => {
    const blocks = [
      makeBlock({ requestId: 'r1', layer: 'mxc:shell-denial-high' }),
      makeBlock({ requestId: 'r2', layer: 'mxc:shell-denial-network' }),
    ];
    const incidents = aggregateSandboxBlocks(blocks);
    expect(incidents).toHaveLength(2);
  });

  it('does NOT collapse when toolName differs', () => {
    const blocks = [
      makeBlock({ requestId: 'r1', toolName: 'bash' }),
      makeBlock({ requestId: 'r2', toolName: 'shell' }),
    ];
    const incidents = aggregateSandboxBlocks(blocks);
    expect(incidents).toHaveLength(2);
  });

  it('does NOT collapse when kind differs', () => {
    const blocks = [
      makeBlock({ requestId: 'r1', kind: 'shell' }),
      makeBlock({ requestId: 'r2', kind: 'write' }),
    ];
    const incidents = aggregateSandboxBlocks(blocks);
    expect(incidents).toHaveLength(2);
  });

  it('keeps pre-tool blocks separate even when target matches (safety)', () => {
    const blocks = [
      makeBlock({ requestId: 'r1', source: 'pre-tool' }),
      makeBlock({ requestId: 'r2', source: 'pre-tool' }),
    ];
    const incidents = aggregateSandboxBlocks(blocks);
    expect(incidents).toHaveLength(2);
    expect(incidents[0].count).toBe(1);
    expect(incidents[1].count).toBe(1);
    expect(incidents[0].key).toBe('unique:r1');
    expect(incidents[1].key).toBe('unique:r2');
  });

  it('keeps permission blocks separate even when target matches', () => {
    const blocks = [
      makeBlock({ requestId: 'r1', source: 'permission' }),
      makeBlock({ requestId: 'r2', source: 'permission' }),
    ];
    const incidents = aggregateSandboxBlocks(blocks);
    expect(incidents).toHaveLength(2);
  });

  it('preserves insertion order across distinct incidents and within a group', () => {
    const blocks = [
      makeBlock({ requestId: 'r1', target: 'cmd-A' }),
      makeBlock({ requestId: 'r2', target: 'cmd-B' }),
      makeBlock({ requestId: 'r3', target: 'cmd-A' }),
      makeBlock({ requestId: 'r4', target: 'cmd-A' }),
    ];
    const incidents = aggregateSandboxBlocks(blocks);
    expect(incidents).toHaveLength(2);
    expect(incidents[0].sample.target).toBe('cmd-A');
    expect(incidents[0].requestIds).toEqual(['r1', 'r3', 'r4']);
    expect(incidents[1].sample.target).toBe('cmd-B');
    expect(incidents[1].requestIds).toEqual(['r2']);
  });

  it('produces empty output for empty input', () => {
    expect(aggregateSandboxBlocks([])).toEqual([]);
  });

  it('mixed post-tool + pre-tool retains both lanes', () => {
    const blocks = [
      makeBlock({ requestId: 'r1', source: 'post-tool-shell' }),
      makeBlock({ requestId: 'r2', source: 'pre-tool' }),
      makeBlock({ requestId: 'r3', source: 'post-tool-shell' }),
    ];
    const incidents = aggregateSandboxBlocks(blocks);
    expect(incidents).toHaveLength(2);
    const postTool = incidents.find(i => i.sample.source === 'post-tool-shell')!;
    const preTool = incidents.find(i => i.sample.source === 'pre-tool')!;
    expect(postTool.requestIds).toEqual(['r1', 'r3']);
    expect(preTool.requestIds).toEqual(['r2']);
  });
});

describe('planIncidentResolve', () => {
  it('single-block incident: returns one entry with the chosen decision', () => {
    const plan = planIncidentResolve({ requestIds: ['r1'] }, 'disable');
    expect(plan).toEqual([{ requestId: 'r1', decision: 'disable' }]);
  });

  it('multi-block incident: first reqId gets decision, rest get allow-once', () => {
    const plan = planIncidentResolve({ requestIds: ['r1', 'r2', 'r3'] }, 'disable');
    expect(plan).toEqual([
      { requestId: 'r1', decision: 'disable' },
      { requestId: 'r2', decision: 'allow-once' },
      { requestId: 'r3', decision: 'allow-once' },
    ]);
  });

  it('allow-once decision applied to first; rest also allow-once (idempotent)', () => {
    const plan = planIncidentResolve({ requestIds: ['r1', 'r2'] }, 'allow-once');
    expect(plan).toEqual([
      { requestId: 'r1', decision: 'allow-once' },
      { requestId: 'r2', decision: 'allow-once' },
    ]);
  });

  it('empty requestIds returns empty plan', () => {
    const plan = planIncidentResolve({ requestIds: [] }, 'disable');
    expect(plan).toEqual([]);
  });
});

describe('truncateCommandPreview', () => {
  it('returns input unchanged when within limit', () => {
    expect(truncateCommandPreview('echo hi', 40)).toBe('echo hi');
  });

  it('truncates and adds ellipsis when over limit', () => {
    const long = 'a'.repeat(100);
    const out = truncateCommandPreview(long, 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });

  it('trims surrounding whitespace before measuring', () => {
    expect(truncateCommandPreview('  echo hi  ', 40)).toBe('echo hi');
  });

  it('default max is 40 characters', () => {
    const long = 'x'.repeat(60);
    expect(truncateCommandPreview(long)).toHaveLength(40);
  });
});
