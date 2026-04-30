import { describe, it, expect } from 'vitest';
import { validateMcpServers, validateCliTools, validateSandboxPolicy } from './validators';
import { DEFAULT_SANDBOX_POLICY } from '../shared/ipc-contract';

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

describe('validateSandboxPolicy', () => {
  it('returns null for non-object input', () => {
    expect(validateSandboxPolicy(null)).toBeNull();
    expect(validateSandboxPolicy('not a policy')).toBeNull();
    expect(validateSandboxPolicy(42)).toBeNull();
    expect(validateSandboxPolicy(undefined)).toBeNull();
  });

  it('fills in defaults for an empty object', () => {
    expect(validateSandboxPolicy({})).toEqual(DEFAULT_SANDBOX_POLICY);
  });

  it('preserves valid boolean fields', () => {
    const result = validateSandboxPolicy({
      scopeToSpaceFolder: false,
      allowOutbound: true,
      allowMcpServers: true,
      allowWebFetch: true,
      allowLocalNetwork: true,
    });
    expect(result).toEqual({
      ...DEFAULT_SANDBOX_POLICY,
      scopeToSpaceFolder: false,
      allowOutbound: true,
      allowMcpServers: true,
      allowWebFetch: true,
      allowLocalNetwork: true,
    });
  });

  it('falls back to defaults for non-boolean fields', () => {
    const result = validateSandboxPolicy({
      scopeToSpaceFolder: 'yes' as any,
      allowOutbound: 1 as any,
    });
    expect(result?.scopeToSpaceFolder).toBe(DEFAULT_SANDBOX_POLICY.scopeToSpaceFolder);
    expect(result?.allowOutbound).toBe(DEFAULT_SANDBOX_POLICY.allowOutbound);
  });

  it('sanitizes path arrays: trims, drops empties, deduplicates', () => {
    const result = validateSandboxPolicy({
      extraReadwritePaths: ['  C:\\foo  ', 'C:\\foo', '', 'C:\\bar'],
      extraReadonlyPaths: [123 as any, 'C:\\baz'],
      extraDeniedPaths: ['C:\\Windows'],
    });
    expect(result?.extraReadwritePaths).toEqual(['C:\\foo', 'C:\\bar']);
    expect(result?.extraReadonlyPaths).toEqual(['C:\\baz']);
    expect(result?.extraDeniedPaths).toEqual(['C:\\Windows']);
  });

  it('caps path array length to prevent unbounded persistence', () => {
    const huge = Array.from({ length: 200 }, (_, i) => `C:\\path${i}`);
    const result = validateSandboxPolicy({ extraReadwritePaths: huge });
    expect(result?.extraReadwritePaths.length).toBeLessThanOrEqual(64);
  });

  it('returns empty array when path field is not an array', () => {
    const result = validateSandboxPolicy({ extraReadwritePaths: 'not an array' });
    expect(result?.extraReadwritePaths).toEqual([]);
  });

  it('preserves enforcementMode = "mxc-only"', () => {
    const result = validateSandboxPolicy({ enforcementMode: 'mxc-only' });
    expect(result?.enforcementMode).toBe('mxc-only');
  });

  it('preserves enforcementMode = "both"', () => {
    const result = validateSandboxPolicy({ enforcementMode: 'both' });
    expect(result?.enforcementMode).toBe('both');
  });

  it('falls back to "both" for invalid enforcementMode values', () => {
    expect(validateSandboxPolicy({ enforcementMode: 'whatever' })?.enforcementMode).toBe('both');
    expect(validateSandboxPolicy({ enforcementMode: 1 as any })?.enforcementMode).toBe('both');
    expect(validateSandboxPolicy({ enforcementMode: null as any })?.enforcementMode).toBe('both');
    expect(validateSandboxPolicy({})?.enforcementMode).toBe('both');
  });
});