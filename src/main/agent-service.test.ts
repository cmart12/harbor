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

import { buildCliToolsPrompt } from './agent-service';

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
