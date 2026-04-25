import { describe, it, expect } from 'vitest';
import { validateMcpServers, validateCliTools } from './validators';

// These are pure validation functions — no Electron mocking needed

describe('validateMcpServers', () => {
  it('rejects non-array input', () => {
    expect(validateMcpServers('not an array')).toEqual({ error: 'invalid payload' });
    expect(validateMcpServers(null)).toEqual({ error: 'invalid payload' });
    expect(validateMcpServers(42)).toEqual({ error: 'invalid payload' });
  });

  it('returns empty array for empty input', () => {
    expect(validateMcpServers([])).toEqual([]);
  });

  it('validates a valid stdio server', () => {
    const result = validateMcpServers([
      { name: 'test-server', type: 'stdio', command: 'npx', args: ['-y', 'pkg'], tools: ['*'] },
    ]);
    expect(result).toEqual([
      { name: 'test-server', type: 'stdio', command: 'npx', args: ['-y', 'pkg'], url: undefined, tools: ['*'] },
    ]);
  });

  it('validates a valid http server', () => {
    const result = validateMcpServers([
      { name: 'remote', type: 'http', url: 'http://localhost:3000/mcp', tools: ['tool1'] },
    ]);
    expect(result).toEqual([
      { name: 'remote', type: 'http', command: undefined, args: [], url: 'http://localhost:3000/mcp', tools: ['tool1'] },
    ]);
  });

  it('skips servers with empty name', () => {
    const result = validateMcpServers([
      { name: '', type: 'stdio', command: 'echo' },
    ]);
    expect(result).toEqual([]);
  });

  it('skips stdio servers without command', () => {
    const result = validateMcpServers([
      { name: 'bad', type: 'stdio' },
    ]);
    expect(result).toEqual([]);
  });

  it('skips http servers without url', () => {
    const result = validateMcpServers([
      { name: 'bad', type: 'http' },
    ]);
    expect(result).toEqual([]);
  });

  it('deduplicates by name (keeps first)', () => {
    const result = validateMcpServers([
      { name: 'dup', type: 'stdio', command: 'first' },
      { name: 'dup', type: 'stdio', command: 'second' },
    ]);
    expect(result).toHaveLength(1);
    expect((result as any)[0].command).toBe('first');
  });

  it('trims name and command', () => {
    const result = validateMcpServers([
      { name: '  trimmed  ', type: 'stdio', command: '  echo  ' },
    ]);
    expect((result as any)[0].name).toBe('trimmed');
    expect((result as any)[0].command).toBe('echo');
  });

  it('defaults type to stdio for unknown types', () => {
    const result = validateMcpServers([
      { name: 'test', type: 'unknown', command: 'echo' },
    ]);
    expect((result as any)[0].type).toBe('stdio');
  });

  it('defaults tools to ["*"] when not provided', () => {
    const result = validateMcpServers([
      { name: 'test', type: 'stdio', command: 'echo' },
    ]);
    expect((result as any)[0].tools).toEqual(['*']);
  });

  it('filters non-string args', () => {
    const result = validateMcpServers([
      { name: 'test', type: 'stdio', command: 'echo', args: ['valid', 42, null, 'also-valid'] },
    ]);
    expect((result as any)[0].args).toEqual(['valid', 'also-valid']);
  });

  it('skips non-object entries', () => {
    const result = validateMcpServers([null, undefined, 'string', 42, { name: 'ok', type: 'stdio', command: 'echo' }]);
    expect(result).toHaveLength(1);
  });
});

describe('validateCliTools', () => {
  it('rejects non-array input', () => {
    expect(validateCliTools('not an array')).toEqual({ error: 'invalid payload' });
    expect(validateCliTools(null)).toEqual({ error: 'invalid payload' });
  });

  it('returns empty array for empty input', () => {
    expect(validateCliTools([])).toEqual([]);
  });

  it('validates a valid tool', () => {
    const result = validateCliTools([
      { name: 'gh', description: 'GitHub CLI for operations' },
    ]);
    expect(result).toEqual([
      { name: 'gh', description: 'GitHub CLI for operations' },
    ]);
  });

  it('skips tools with empty name', () => {
    const result = validateCliTools([
      { name: '', description: 'something' },
    ]);
    expect(result).toEqual([]);
  });

  it('skips tools with empty description', () => {
    const result = validateCliTools([
      { name: 'gh', description: '' },
    ]);
    expect(result).toEqual([]);
  });

  it('deduplicates by name', () => {
    const result = validateCliTools([
      { name: 'gh', description: 'first' },
      { name: 'gh', description: 'second' },
    ]);
    expect(result).toHaveLength(1);
    expect((result as any)[0].description).toBe('first');
  });

  it('trims name and description', () => {
    const result = validateCliTools([
      { name: '  gh  ', description: '  GitHub CLI  ' },
    ]);
    expect((result as any)[0].name).toBe('gh');
    expect((result as any)[0].description).toBe('GitHub CLI');
  });

  it('truncates description to 500 chars', () => {
    const longDesc = 'x'.repeat(600);
    const result = validateCliTools([
      { name: 'tool', description: longDesc },
    ]);
    expect((result as any)[0].description).toHaveLength(500);
  });

  it('skips non-object entries', () => {
    const result = validateCliTools([null, 'string', { name: 'ok', description: 'valid' }]);
    expect(result).toHaveLength(1);
  });
});
