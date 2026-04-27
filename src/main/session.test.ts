import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExistsSync, mockStatSync, mockMkdirSync, mockExecSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(p: unknown) => boolean>(),
  mockStatSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockExecSync: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/intent-test' },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: mockExistsSync, statSync: mockStatSync, mkdirSync: mockMkdirSync };
});

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, execSync: mockExecSync };
});

vi.mock('./config', () => ({
  getConfigValue: vi.fn(),
  getSessionId: vi.fn(),
  setSessionId: vi.fn(),
}));

vi.mock('./database', () => ({
  getIntent: vi.fn(),
  assignIntentFolder: vi.fn(),
  setIntentSessionId: vi.fn(),
}));

vi.mock('./workspace', () => ({
  createIntentFolder: vi.fn(),
}));

import { resolveCopilotCliPath, invalidateCliPath, checkCopilotCli, launchSession, parseCliVersion, compareVersions, getCopilotCliVersion, checkCliCompatibility, resolveCmdToJs, MIN_CLI_VERSION } from './session';
import { getConfigValue } from './config';

const mockGetConfigValue = vi.mocked(getConfigValue);

describe('session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCliPath();
  });

  // ── resolveCopilotCliPath ─────────────────────────────

  describe('resolveCopilotCliPath', () => {
    it('returns configured cliPath if it exists on disk', () => {
      mockGetConfigValue.mockReturnValue('/custom/bin/copilot');
      mockExistsSync.mockReturnValue(true);

      const result = resolveCopilotCliPath();
      expect(result).toBe('/custom/bin/copilot');
    });

    it('falls back to auto-detect if configured cliPath does not exist', () => {
      mockGetConfigValue.mockReturnValue('/missing/copilot');
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = resolveCopilotCliPath();
      expect(result).toBeNull();
    });

    it('auto-detects via which/where when no config override is set', () => {
      mockGetConfigValue.mockReturnValue(null);
      mockExistsSync.mockImplementation((p: unknown) => {
        return p === '/usr/local/bin/copilot-found';
      });
      mockExecSync.mockReturnValue(
        Buffer.from('/usr/local/bin/copilot-found\n')
      );

      const result = resolveCopilotCliPath();
      expect(result).toBe('/usr/local/bin/copilot-found');
    });

    it('caches result after first call', () => {
      mockGetConfigValue.mockReturnValue('/cached/copilot');
      mockExistsSync.mockReturnValue(true);

      const first = resolveCopilotCliPath();
      expect(first).toBe('/cached/copilot');

      // Change mock — should still return cached value
      mockGetConfigValue.mockReturnValue('/other/copilot');

      const second = resolveCopilotCliPath();
      expect(second).toBe('/cached/copilot');
    });

    it('re-resolves after invalidateCliPath()', () => {
      mockGetConfigValue.mockReturnValue('/first/copilot');
      mockExistsSync.mockReturnValue(true);

      expect(resolveCopilotCliPath()).toBe('/first/copilot');

      invalidateCliPath();
      mockGetConfigValue.mockReturnValue('/second/copilot');

      expect(resolveCopilotCliPath()).toBe('/second/copilot');
    });

    it('skips node_modules shims from which output', () => {
      mockGetConfigValue.mockReturnValue(null);
      mockExistsSync.mockImplementation((p: unknown) => {
        return p === '/home/user/.npm-global/bin/copilot';
      });
      mockExecSync.mockReturnValue(
        Buffer.from('/project/node_modules/.bin/copilot\n/home/user/.npm-global/bin/copilot\n')
      );

      const result = resolveCopilotCliPath();
      expect(result).toBe('/home/user/.npm-global/bin/copilot');
    });
  });

  // ── resolveCmdToJs ────────────────────────────────────

  describe('resolveCmdToJs', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('resolves .cmd to @github/copilot/index.js in the same npm prefix', () => {
      mockExistsSync.mockImplementation((p: unknown) => {
        return p === 'C:\\ProgramData\\npm\\node_modules\\@github\\copilot\\index.js';
      });

      const result = resolveCmdToJs('C:\\ProgramData\\npm\\copilot.cmd');
      expect(result).toBe('C:\\ProgramData\\npm\\node_modules\\@github\\copilot\\index.js');
    });

    it('returns original .cmd if index.js does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = resolveCmdToJs('C:\\ProgramData\\npm\\copilot.cmd');
      expect(result).toBe('C:\\ProgramData\\npm\\copilot.cmd');
    });

    it('returns original path for non-.cmd files', () => {
      const result = resolveCmdToJs('/usr/local/bin/copilot');
      expect(result).toBe('/usr/local/bin/copilot');
      expect(mockExistsSync).not.toHaveBeenCalled();
    });

    it('returns original path on non-win32 platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const result = resolveCmdToJs('C:\\ProgramData\\npm\\copilot.cmd');
      expect(result).toBe('C:\\ProgramData\\npm\\copilot.cmd');
      expect(mockExistsSync).not.toHaveBeenCalled();
    });
  });

  // ── checkCopilotCli (deprecated wrapper) ──────────────

  describe('checkCopilotCli', () => {
    it('returns same value as resolveCopilotCliPath', async () => {
      mockGetConfigValue.mockReturnValue('/cli/copilot');
      mockExistsSync.mockReturnValue(true);

      const sync = resolveCopilotCliPath();
      invalidateCliPath();
      const asyncResult = await checkCopilotCli();
      expect(asyncResult).toBe(sync);
    });
  });

  // ── launchSession validation ──────────────────────────

  describe('launchSession', () => {
    it('returns error when workspace directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await launchSession('intent-1', '/nonexistent/workspace');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Workspace directory does not exist');
    });

    it('returns error when copilot CLI is not found', async () => {
      mockGetConfigValue.mockReturnValue(null);

      // Workspace exists and is a directory
      mockExistsSync.mockImplementation((p: unknown) => {
        if (p === '/valid/workspace') return true;
        return false;
      });
      mockStatSync.mockImplementation((p: unknown) => {
        if (p === '/valid/workspace') {
          return { isDirectory: () => true } as import('fs').Stats;
        }
        throw new Error('ENOENT');
      });

      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = await launchSession('intent-2', '/valid/workspace');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Copilot CLI not found');
    });
  });

  // ── parseCliVersion ──────────────────────────────────

  describe('parseCliVersion', () => {
    it('parses standard version output', () => {
      expect(parseCliVersion('GitHub Copilot CLI 1.0.36.')).toBe('1.0.36');
    });

    it('parses version with extra text', () => {
      expect(parseCliVersion('GitHub Copilot CLI 1.0.36.\nRun \'copilot update\' to check for updates.')).toBe('1.0.36');
    });

    it('parses just a version number', () => {
      expect(parseCliVersion('2.1.0')).toBe('2.1.0');
    });

    it('returns null for unparseable output', () => {
      expect(parseCliVersion('no version here')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseCliVersion('')).toBeNull();
    });
  });

  // ── compareVersions ──────────────────────────────────

  describe('compareVersions', () => {
    it('returns 0 for equal versions', () => {
      expect(compareVersions('1.0.36', '1.0.36')).toBe(0);
    });

    it('returns positive when a > b (patch)', () => {
      expect(compareVersions('1.0.37', '1.0.36')).toBeGreaterThan(0);
    });

    it('returns negative when a < b (patch)', () => {
      expect(compareVersions('1.0.35', '1.0.36')).toBeLessThan(0);
    });

    it('returns positive when a > b (minor)', () => {
      expect(compareVersions('1.1.0', '1.0.36')).toBeGreaterThan(0);
    });

    it('returns positive when a > b (major)', () => {
      expect(compareVersions('2.0.0', '1.0.36')).toBeGreaterThan(0);
    });

    it('returns negative when a < b (major)', () => {
      expect(compareVersions('0.9.99', '1.0.0')).toBeLessThan(0);
    });

    it('handles different length versions', () => {
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
    });
  });

  // ── getCopilotCliVersion ─────────────────────────────

  describe('getCopilotCliVersion', () => {
    it('returns parsed version when CLI responds', () => {
      mockGetConfigValue.mockReturnValue('/usr/bin/copilot');
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue(Buffer.from('GitHub Copilot CLI 1.0.36.\n'));

      const version = getCopilotCliVersion();
      expect(version).toBe('1.0.36');
    });

    it('returns null when CLI is not found', () => {
      mockGetConfigValue.mockReturnValue(null);
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });

      const version = getCopilotCliVersion();
      expect(version).toBeNull();
    });

    it('returns null when version output is unparseable', () => {
      mockGetConfigValue.mockReturnValue('/usr/bin/copilot');
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue(Buffer.from('some unexpected output'));

      const version = getCopilotCliVersion();
      expect(version).toBeNull();
    });

    it('caches result after first call', () => {
      mockGetConfigValue.mockReturnValue('/usr/bin/copilot');
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue(Buffer.from('GitHub Copilot CLI 1.0.36.\n'));

      const first = getCopilotCliVersion();
      expect(first).toBe('1.0.36');

      // Change mock — should still return cached value
      mockExecSync.mockReturnValue(Buffer.from('GitHub Copilot CLI 2.0.0.\n'));
      const second = getCopilotCliVersion();
      expect(second).toBe('1.0.36');
    });

    it('re-resolves after invalidateCliPath()', () => {
      mockGetConfigValue.mockReturnValue('/usr/bin/copilot');
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue(Buffer.from('GitHub Copilot CLI 1.0.36.\n'));

      expect(getCopilotCliVersion()).toBe('1.0.36');

      invalidateCliPath();
      mockExecSync.mockReturnValue(Buffer.from('GitHub Copilot CLI 1.0.40.\n'));
      expect(getCopilotCliVersion()).toBe('1.0.40');
    });
  });

  // ── checkCliCompatibility ────────────────────────────

  describe('checkCliCompatibility', () => {
    it('returns compatible for version >= minimum', () => {
      mockGetConfigValue.mockReturnValue('/usr/bin/copilot');
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue(Buffer.from('GitHub Copilot CLI 1.0.36.\n'));

      const info = checkCliCompatibility();
      expect(info.path).toBe('/usr/bin/copilot');
      expect(info.version).toBe('1.0.36');
      expect(info.compatible).toBe(true);
      expect(info.minVersion).toBe(MIN_CLI_VERSION);
    });

    it('returns compatible for version > minimum', () => {
      mockGetConfigValue.mockReturnValue('/usr/bin/copilot');
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue(Buffer.from('GitHub Copilot CLI 2.0.0.\n'));

      const info = checkCliCompatibility();
      expect(info.compatible).toBe(true);
    });

    it('returns incompatible for version < minimum', () => {
      mockGetConfigValue.mockReturnValue('/usr/bin/copilot');
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue(Buffer.from('GitHub Copilot CLI 1.0.35.\n'));

      const info = checkCliCompatibility();
      expect(info.path).toBe('/usr/bin/copilot');
      expect(info.version).toBe('1.0.35');
      expect(info.compatible).toBe(false);
    });

    it('returns incompatible when CLI not found', () => {
      mockGetConfigValue.mockReturnValue(null);
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });

      const info = checkCliCompatibility();
      expect(info.path).toBeNull();
      expect(info.version).toBeNull();
      expect(info.compatible).toBe(false);
    });

    it('returns incompatible when version cannot be parsed', () => {
      mockGetConfigValue.mockReturnValue('/usr/bin/copilot');
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue(Buffer.from('unexpected output'));

      const info = checkCliCompatibility();
      expect(info.path).toBe('/usr/bin/copilot');
      expect(info.version).toBeNull();
      expect(info.compatible).toBe(false);
    });
  });
});
