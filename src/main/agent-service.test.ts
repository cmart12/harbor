import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron (required by config.ts)
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/intent-test' },
  BrowserWindow: { getAllWindows: () => [] },
}));

// Mock the heavy dependencies that agent-service imports
vi.mock('./ai', () => ({
  getCopilotClient: vi.fn().mockReturnValue(null),
}));

vi.mock('./database', () => ({
  createCanvasAgent: vi.fn(),
  updateCanvasAgentStatus: vi.fn(),
  createAgentSession: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
  getAgentSession: vi.fn(),
  listAgentSessions: vi.fn(),
}));

vi.mock('./workspace', () => ({
  readCanvas: vi.fn(),
}));

vi.mock('./session', () => ({
  launchSessionInTerminal: vi.fn(),
}));

vi.mock('./mcp', () => ({
  getAllMcpServers: vi.fn().mockReturnValue({}),
}));

// Mock config to return controlled values
const mockCliTools = vi.fn().mockReturnValue([]);
vi.mock('./config', () => ({
  getConfig: vi.fn().mockReturnValue({ workspace: null }),
  getConfigValue: (...args: any[]) => {
    if (args[0] === 'cliTools') return mockCliTools();
    return [];
  },
}));

import { buildCliToolsPrompt, respondToUserInput, respondToElicitation } from './agent-service';

describe('buildCliToolsPrompt', () => {
  beforeEach(() => {
    mockCliTools.mockReturnValue([]);
  });

  it('returns empty string when no CLI tools configured', () => {
    const result = buildCliToolsPrompt();
    expect(result).toBe('');
  });

  it('generates prompt with single tool', () => {
    mockCliTools.mockReturnValue([
      { name: 'gh', description: 'Used for GitHub operations' },
    ]);

    const result = buildCliToolsPrompt();
    expect(result).toContain('CLI tools may be available');
    expect(result).toContain('`gh`');
    expect(result).toContain('Used for GitHub operations');
  });

  it('generates prompt with multiple tools', () => {
    mockCliTools.mockReturnValue([
      { name: 'gh', description: 'GitHub operations' },
      { name: 'az', description: 'Azure CLI' },
      { name: 'kubectl', description: 'Kubernetes control' },
    ]);

    const result = buildCliToolsPrompt();
    expect(result).toContain('`gh`');
    expect(result).toContain('`az`');
    expect(result).toContain('`kubectl`');
    // Each tool on its own line
    const lines = result.split('\n').filter(l => l.startsWith('- `'));
    expect(lines).toHaveLength(3);
  });

  it('includes advisory phrasing (verify before use)', () => {
    mockCliTools.mockReturnValue([
      { name: 'gh', description: 'GitHub' },
    ]);

    const result = buildCliToolsPrompt();
    expect(result).toContain('verify before use');
  });
});

describe('respondToUserInput', () => {
  it('does not throw when no matching callback exists', () => {
    expect(() => {
      respondToUserInput('agent-1', 'nonexistent-request', 'hello', true);
    }).not.toThrow();
  });

  it('can be called multiple times with same requestId without error', () => {
    respondToUserInput('agent-1', 'req-1', 'answer1', false);
    respondToUserInput('agent-1', 'req-1', 'answer2', true);
    // Second call is a no-op since callback was already removed
  });
});

describe('respondToElicitation', () => {
  it('does not throw when no matching callback exists', () => {
    expect(() => {
      respondToElicitation('agent-1', 'nonexistent-request', 'accept', { key: 'val' });
    }).not.toThrow();
  });

  it('handles decline action without content', () => {
    expect(() => {
      respondToElicitation('agent-1', 'req-1', 'decline');
    }).not.toThrow();
  });

  it('handles cancel action without content', () => {
    expect(() => {
      respondToElicitation('agent-1', 'req-1', 'cancel');
    }).not.toThrow();
  });
});
