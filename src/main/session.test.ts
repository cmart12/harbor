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

import { resolveCopilotCliPath, invalidateCliPath, checkCopilotCli, launchSession } from './session';
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
});
