import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

// Mock electron before importing config
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/space-test-config',
  },
}));

import { loadConfig, getConfig, getConfigValue, setConfigValue, getSessionId, setSessionId, removeSession, saveConfig } from './config';

const CONFIG_PATH = path.join('/tmp/space-test-config', 'config.json');

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
      expect(config.theme).toBe('dark');
      expect(config.model).toBeNull();
      expect(config.workspace).toBeNull();
      expect(config.personas).toEqual([]);
      expect(config.personasSeeded).toBe(false);
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
      expect(config.theme).toBe('dark');      expect(config.cliTools).toEqual([]);
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

  describe('getSessionId / setSessionId / removeSession', () => {
    it('stores and retrieves a session ID', () => {
      loadConfig();
      setSessionId('space-1', 'session-abc');
      expect(getSessionId('space-1')).toBe('session-abc');
    });

    it('returns null for an unknown space ID', () => {
      loadConfig();
      expect(getSessionId('nonexistent')).toBeNull();
    });

    it('removes a stored session ID', () => {
      loadConfig();
      setSessionId('space-2', 'session-xyz');
      expect(getSessionId('space-2')).toBe('session-xyz');
      removeSession('space-2');
      expect(getSessionId('space-2')).toBeNull();
    });

    it('persists session IDs to disk', () => {
      loadConfig();
      setSessionId('space-3', 'session-disk');

      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      expect(raw.sessions['space-3']).toBe('session-disk');
    });

    it('removes session ID from disk after removeSession', () => {
      loadConfig();
      setSessionId('space-4', 'session-temp');
      removeSession('space-4');

      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      expect(raw.sessions['space-4']).toBeUndefined();
    });
  });

  describe('saveConfig failure handling', () => {
    it('handles write errors gracefully', () => {
      loadConfig();
      // Remove the directory so writeFileSync fails with ENOENT
      fs.rmSync(path.dirname(CONFIG_PATH), { recursive: true });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => saveConfig()).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[config] Failed to save config:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
      // Recreate directory for afterEach cleanup
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    });
  });

  describe('config shape preservation', () => {
    it('setting one key does not remove other keys from persisted file', () => {
      loadConfig();
      setConfigValue('theme', 'dark');
      setConfigValue('model', 'gpt-4');

      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      expect(raw.theme).toBe('dark');
      expect(raw.model).toBe('gpt-4');
    });
  });

  describe('edge cases', () => {
    it('loading config with extra unknown fields does not crash', () => {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({
        theme: 'dark',
        unknownField: 'hello',
        anotherFutureField: 42,
      }));
      const config = loadConfig();
      expect(config.theme).toBe('dark');
      expect((config as unknown as Record<string, unknown>)['unknownField']).toBe('hello');
    });

    it('setConfigValue for sessions persists the full sessions map', () => {
      loadConfig();
      const sessions: Record<string, string> = {
        'space-a': 'sess-1',
        'space-b': 'sess-2',
      };
      setConfigValue('sessions', sessions);

      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      expect(raw.sessions).toEqual(sessions);
    });
  });
});
