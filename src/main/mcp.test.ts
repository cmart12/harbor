import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron (required by config.ts)
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/intent-test' },
}));

// Mock fs for controlled filesystem behavior
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

// Mock os.homedir
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => '/mock-home',
  };
});

// Mock config module to control getConfigValue
vi.mock('./config', () => ({
  getConfigValue: vi.fn().mockReturnValue([]),
}));

import { existsSync, readFileSync, readdirSync } from 'fs';
import { discoverMCPServers, getAllMcpServers, listDiscoveredMcpServers } from './mcp';
import { getConfigValue } from './config';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockGetConfigValue = vi.mocked(getConfigValue);

describe('mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('discoverMCPServers', () => {
    it('returns empty when no config files exist', () => {
      mockExistsSync.mockReturnValue(false);
      const result = discoverMCPServers();
      expect(result).toEqual({});
    });

    it('reads from ~/.copilot/mcp-config.json', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return String(p) === '/mock-home/.copilot/mcp-config.json';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        mcpServers: {
          'github-server': {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            tools: ['*'],
          },
        },
      }));

      const result = discoverMCPServers();
      expect(result).toHaveProperty('github-server');
      expect((result['github-server'] as any).command).toBe('npx');
    });

    it('reads from installed plugins', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        return s === '/mock-home/.copilot/installed-plugins' ||
               s === '/mock-home/.copilot/installed-plugins/ns1/plugin1/.mcp.json';
      });
      mockReaddirSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s === '/mock-home/.copilot/installed-plugins') return ['ns1'] as any;
        if (s === '/mock-home/.copilot/installed-plugins/ns1') return ['plugin1'] as any;
        return [] as any;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        mcpServers: {
          'plugin-server': {
            type: 'http',
            url: 'http://localhost:3001',
            tools: ['*'],
          },
        },
      }));

      const result = discoverMCPServers();
      expect(result).toHaveProperty('plugin-server');
      expect((result['plugin-server'] as any).url).toBe('http://localhost:3001');
    });

    it('handles malformed JSON gracefully', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return String(p) === '/mock-home/.copilot/mcp-config.json';
      });
      mockReadFileSync.mockReturnValue('not valid json');

      const result = discoverMCPServers();
      expect(result).toEqual({});
    });

    it('merges servers from config and plugins', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s === '/mock-home/.copilot/installed-plugins') return ['ns1'] as any;
        if (s === '/mock-home/.copilot/installed-plugins/ns1') return ['p1'] as any;
        return [] as any;
      });
      mockReadFileSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s === '/mock-home/.copilot/mcp-config.json') {
          return JSON.stringify({ mcpServers: { 'from-config': { command: 'a', args: [], tools: ['*'] } } });
        }
        if (s.endsWith('.mcp.json')) {
          return JSON.stringify({ mcpServers: { 'from-plugin': { command: 'b', args: [], tools: ['*'] } } });
        }
        return '{}';
      });

      const result = discoverMCPServers();
      expect(Object.keys(result)).toContain('from-config');
      expect(Object.keys(result)).toContain('from-plugin');
    });
  });

  describe('getAllMcpServers', () => {
    it('merges discovered and custom servers', () => {
      // Set up discovered
      mockExistsSync.mockImplementation((p: any) => {
        return String(p) === '/mock-home/.copilot/mcp-config.json';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        mcpServers: { 'discovered': { command: 'x', args: [], tools: ['*'] } },
      }));

      // Set up custom via config mock
      mockGetConfigValue.mockReturnValue([
        { name: 'custom', type: 'stdio', command: 'y', args: [], tools: ['*'] },
      ] as any);

      const result = getAllMcpServers();
      expect(result).toHaveProperty('discovered');
      expect(result).toHaveProperty('custom');
    });

    it('custom servers override discovered with same name', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return String(p) === '/mock-home/.copilot/mcp-config.json';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        mcpServers: { 'server': { command: 'old', args: [], tools: ['*'] } },
      }));

      mockGetConfigValue.mockReturnValue([
        { name: 'server', type: 'stdio', command: 'new', args: [], tools: ['*'] },
      ] as any);

      const result = getAllMcpServers();
      expect((result['server'] as any).command).toBe('new');
    });
  });

  describe('listDiscoveredMcpServers', () => {
    it('returns sanitized server info (no env/headers)', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return String(p) === '/mock-home/.copilot/mcp-config.json';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        mcpServers: {
          'server': {
            command: 'npx',
            args: ['-y', 'some-pkg'],
            env: { SECRET_KEY: 'should-not-appear' },
            tools: ['*'],
          },
        },
      }));

      const result = listDiscoveredMcpServers();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('server');
      expect(result[0].source).toBe('config');
      expect(result[0].command).toBe('npx');
      // Secrets should NOT be in the result
      expect(result[0]).not.toHaveProperty('env');
      expect(result[0]).not.toHaveProperty('args');
    });

    it('labels plugin-discovered servers correctly', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        return s === '/mock-home/.copilot/installed-plugins' ||
               s === '/mock-home/.copilot/installed-plugins/org/tool/.mcp.json';
      });
      mockReaddirSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s === '/mock-home/.copilot/installed-plugins') return ['org'] as any;
        if (s === '/mock-home/.copilot/installed-plugins/org') return ['tool'] as any;
        return [] as any;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        mcpServers: { 'tool-server': { command: 'tool', args: [], tools: ['*'] } },
      }));

      const result = listDiscoveredMcpServers();
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('plugin');
    });
  });
});
