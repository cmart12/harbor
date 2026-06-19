import { describe, it, expect, vi } from 'vitest';

// Mock ai to avoid Electron dependency chain
vi.mock('../ai', () => ({
  getEphemeralCopilotClient: vi.fn(),
}));
vi.mock('../notif-db', () => ({}));
vi.mock('../ipc/typed-handler', () => ({ sendToAllWindows: vi.fn() }));
vi.mock('../main-log', () => ({ mainLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../agents/in-memory-fs-provider', () => ({ InMemoryFsProvider: class {} }));
vi.mock('../mcp', () => ({ getAllMcpServers: vi.fn().mockReturnValue({}) }));

import { deduplicateCandidates, levenshteinDistance } from './morning-curator';

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns length of other for empty string', () => {
    expect(levenshteinDistance('', 'test')).toBe(4);
    expect(levenshteinDistance('test', '')).toBe(4);
  });

  it('computes single char difference', () => {
    expect(levenshteinDistance('cat', 'car')).toBe(1);
  });

  it('computes multiple differences', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('deduplicateCandidates', () => {
  const existing = [
    { title: 'Review PR #123' },
    { title: 'Update documentation for API v2' },
    { title: 'Fix login bug' },
  ];

  it('keeps candidates that do not match existing', () => {
    const candidates = [
      { kind: 'task', title: 'Write new unit tests', priority: 'today' },
      { kind: 'task', title: 'Deploy to staging', priority: 'whenever' },
    ];
    const result = deduplicateCandidates(candidates, existing);
    expect(result).toHaveLength(2);
  });

  it('removes candidates whose title is contained in existing', () => {
    const candidates = [
      { kind: 'task', title: 'Review PR #123', priority: 'today' },
    ];
    const result = deduplicateCandidates(candidates, existing);
    expect(result).toHaveLength(0);
  });

  it('removes candidates when existing title contains candidate (case-insensitive)', () => {
    const candidates = [
      { kind: 'task', title: 'update documentation for api v2', priority: 'today' },
    ];
    const result = deduplicateCandidates(candidates, existing);
    expect(result).toHaveLength(0);
  });

  it('removes candidates when existing title is a substring of candidate', () => {
    const candidates = [
      { kind: 'task', title: 'Please review PR #123 urgently', priority: 'urgent' },
    ];
    const result = deduplicateCandidates(candidates, existing);
    expect(result).toHaveLength(0);
  });

  it('removes candidates with Levenshtein distance < 5 from existing', () => {
    // "Fix login bug" vs "Fix login bugs" => distance 1
    const candidates = [
      { kind: 'task', title: 'Fix login bugs', priority: 'today' },
    ];
    const result = deduplicateCandidates(candidates, existing);
    expect(result).toHaveLength(0);
  });

  it('keeps candidates with Levenshtein distance >= 5 from all existing', () => {
    // "Fix login bug" vs "Fix upload bug" => distance > 5
    const candidates = [
      { kind: 'task', title: 'Fix upload issue in dashboard', priority: 'today' },
    ];
    const result = deduplicateCandidates(candidates, existing);
    expect(result).toHaveLength(1);
  });

  it('handles empty existing list', () => {
    const candidates = [
      { kind: 'task', title: 'Anything', priority: 'today' },
    ];
    const result = deduplicateCandidates(candidates, []);
    expect(result).toHaveLength(1);
  });

  it('handles empty candidates list', () => {
    const result = deduplicateCandidates([], existing);
    expect(result).toHaveLength(0);
  });
});
