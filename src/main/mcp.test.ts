import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// Mock electron (required by config.ts)
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/space-test' },
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

// Build platform-correct paths from the mock homedir
const MOCK_HOME = '/mock-home';
const copilotDir = path.join(MOCK_HOME, '.copilot');
const mcpConfigPath = path.join(copilotDir, 'mcp-config.json');
const pluginsDir = path.join(copilotDir, 'installed-plugins');

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
        return String(p) === mcpConfigPath;
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
        return s === pluginsDir ||
               s === path.join(pluginsDir, 'ns1', 'plugin1', '.mcp.json');
      });
      mockReaddirSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s === pluginsDir) return ['ns1'] as any;
        if (s === path.join(pluginsDir, 'ns1')) return ['plugin1'] as any;
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
        return String(p) === mcpConfigPath;
      });
      mockReadFileSync.mockReturnValue('not valid json');

      const result = discoverMCPServers();
      expect(result).toEqual({});
    });

    it('merges servers from config and plugins', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s === pluginsDir) return ['ns1'] as any;
        if (s === path.join(pluginsDir, 'ns1')) return ['p1'] as any;
        return [] as any;
      });
      mockReadFileSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s === mcpConfigPath) {
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
        return String(p) === mcpConfigPath;
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
        return String(p) === mcpConfigPath;
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

    it('forwards OAuth fields for custom http servers', () => {
      mockExistsSync.mockReturnValue(false);
      mockGetConfigValue.mockReturnValue([
        {
          name: 'slack',
          type: 'http',
          url: 'https://mcp.slack.com/mcp',
          tools: ['*'],
          oauthClientId: '12345.67890',
          oauthPublicClient: true,
        },
      ] as any);

      const result = getAllMcpServers();
      const slack = result['slack'] as any;
      expect(slack).toBeDefined();
      expect(slack.type).toBe('http');
      expect(slack.url).toBe('https://mcp.slack.com/mcp');
      expect(slack.oauthClientId).toBe('12345.67890');
      expect(slack.oauthPublicClient).toBe(true);
    });

    it('forwards headers for custom http servers', () => {
      mockExistsSync.mockReturnValue(false);
      mockGetConfigValue.mockReturnValue([
        {
          name: 'datadog',
          type: 'http',
          url: 'https://mcp.datadoghq.com/mcp',
          tools: ['*'],
          headers: { 'X-Custom': 'value' },
        },
      ] as any);

      const result = getAllMcpServers();
      const dd = result['datadog'] as any;
      expect(dd.headers).toEqual({ 'X-Custom': 'value' });
    });

    it('omits OAuth fields when not set on custom server', () => {
      mockExistsSync.mockReturnValue(false);
      mockGetConfigValue.mockReturnValue([
        {
          name: 'plain',
          type: 'http',
          url: 'https://example.com/mcp',
          tools: [],
        },
      ] as any);

      const result = getAllMcpServers();
      const plain = result['plain'] as any;
      expect(plain.type).toBe('http');
      expect(plain.tools).toEqual(['*']);
      expect(plain).not.toHaveProperty('oauthClientId');
      expect(plain).not.toHaveProperty('oauthPublicClient');
      expect(plain).not.toHaveProperty('headers');
    });
  });

  describe('listDiscoveredMcpServers', () => {
    it('returns sanitized server info (no env/headers)', () => {
      mockExistsSync.mockImplementation((p: any) => {
        return String(p) === mcpConfigPath;
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
        return s === pluginsDir ||
               s === path.join(pluginsDir, 'org', 'tool', '.mcp.json');
      });
      mockReaddirSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s === pluginsDir) return ['org'] as any;
        if (s === path.join(pluginsDir, 'org')) return ['tool'] as any;
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
