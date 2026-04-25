import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

// Mock electron before importing config
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/intent-test-config',
  },
}));

import { loadConfig, saveConfig, getConfig, getConfigValue, setConfigValue } from './config';

const CONFIG_PATH = path.join('/tmp/intent-test-config', 'config.json');

describe('config', () => {
  beforeEach(() => {
    // Clean up any leftover config file
    try { fs.unlinkSync(CONFIG_PATH); } catch { /* ignore */ }
    try { fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true }); } catch { /* ignore */ }
  });

  afterEach(() => {
    try { fs.unlinkSync(CONFIG_PATH); } catch { /* ignore */ }
  });

  describe('loadConfig', () => {
    it('returns defaults when no config file exists', () => {
      const config = loadConfig();
      expect(config.theme).toBe('light');
      expect(config.model).toBeNull();
      expect(config.workspace).toBeNull();
      expect(config.personas).toEqual([]);
    });

    it('includes new cliTools field with default empty array', () => {
      const config = loadConfig();
      expect(config.cliTools).toEqual([]);
    });

    it('includes new mcpServers field with default empty array', () => {
      const config = loadConfig();
      expect(config.mcpServers).toEqual([]);
    });

    it('loads existing config and merges with defaults', () => {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({
        theme: 'dark',
        model: 'gpt-4',
      }));
      const config = loadConfig();
      expect(config.theme).toBe('dark');
      expect(config.model).toBe('gpt-4');
      // Defaults for missing fields
      expect(config.cliTools).toEqual([]);
      expect(config.mcpServers).toEqual([]);
      expect(config.personas).toEqual([]);
    });

    it('handles malformed JSON gracefully', () => {
      fs.writeFileSync(CONFIG_PATH, 'not json');
      const config = loadConfig();
      expect(config.theme).toBe('light');
      expect(config.cliTools).toEqual([]);
    });
  });

  describe('getConfigValue / setConfigValue', () => {
    it('gets and sets values', () => {
      loadConfig();
      setConfigValue('theme', 'dark');
      expect(getConfigValue('theme')).toBe('dark');
    });

    it('persists cliTools to disk', () => {
      loadConfig();
      const tools = [{ name: 'gh', description: 'GitHub CLI' }];
      setConfigValue('cliTools', tools);

      // Re-read from disk
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      expect(raw.cliTools).toEqual(tools);
    });

    it('persists mcpServers to disk', () => {
      loadConfig();
      const servers = [{ name: 'test', type: 'stdio' as const, command: 'echo', args: [], tools: ['*'] }];
      setConfigValue('mcpServers', servers);

      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      expect(raw.mcpServers).toEqual(servers);
    });
  });

  describe('getConfig', () => {
    it('returns the full config object', () => {
      loadConfig();
      const config = getConfig();
      expect(config).toHaveProperty('theme');
      expect(config).toHaveProperty('cliTools');
      expect(config).toHaveProperty('mcpServers');
      expect(config).toHaveProperty('personas');
    });
  });
});
