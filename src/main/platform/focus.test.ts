import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

import { focusTerminalWindow, type FocusOptions } from './focus';

// ── Helpers ─────────────────────────────────────────────

function stubPlatform(value: string) {
  return vi.spyOn(process, 'platform', 'get').mockReturnValue(value as NodeJS.Platform);
}

describe('focusTerminalWindow', () => {
  let platformSpy: ReturnType<typeof stubPlatform>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    platformSpy?.mockRestore();
  });

  // ── macOS ───────────────────────────────────────────

  describe('macOS', () => {
    beforeEach(() => {
      platformSpy = stubPlatform('darwin');
    });

    it('uses osascript to activate Terminal', async () => {
      mockExecSync.mockReturnValue(Buffer.from('True'));

      const result = await focusTerminalWindow({ title: 'test-session' });

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledTimes(1);
      const cmd = mockExecSync.mock.calls[0][0] as string;
      expect(cmd).toContain('osascript');
      expect(cmd).toContain('Terminal');
      expect(cmd).toContain('test-session');
    });

    it('returns true on Fallback response', async () => {
      mockExecSync.mockReturnValue(Buffer.from('Fallback'));

      const result = await focusTerminalWindow({});

      expect(result).toBe(true);
    });

    it('returns false when osascript fails', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('osascript failed');
      });

      const result = await focusTerminalWindow({ title: 'x' });

      expect(result).toBe(false);
    });

    it('escapes double quotes in title', async () => {
      mockExecSync.mockReturnValue(Buffer.from('True'));

      await focusTerminalWindow({ title: 'my "session"' });

      const cmd = mockExecSync.mock.calls[0][0] as string;
      expect(cmd).toContain('my \\"session\\"');
    });
  });

  // ── Windows ─────────────────────────────────────────

  describe('Windows', () => {
    beforeEach(() => {
      platformSpy = stubPlatform('win32');
    });

    it('returns false when no PID is provided', async () => {
      const result = await focusTerminalWindow({});

      expect(result).toBe(false);
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('calls powershell with AppActivate for given PID', async () => {
      mockExecSync.mockReturnValue(Buffer.from('True'));

      const result = await focusTerminalWindow({ pid: 4567 });

      expect(result).toBe(true);
      const cmd = mockExecSync.mock.calls[0][0] as string;
      expect(cmd).toContain('powershell');
      expect(cmd).toContain('AppActivate');
      expect(cmd).toContain('4567');
    });

    it('returns false when powershell returns False', async () => {
      mockExecSync.mockReturnValue(Buffer.from('False'));

      const result = await focusTerminalWindow({ pid: 4567 });

      expect(result).toBe(false);
    });

    it('returns false when powershell throws', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('powershell failed');
      });

      const result = await focusTerminalWindow({ pid: 4567 });

      expect(result).toBe(false);
    });
  });

  // ── Linux ───────────────────────────────────────────

  describe('Linux', () => {
    beforeEach(() => {
      platformSpy = stubPlatform('linux');
    });

    it('returns false when no PID is provided', async () => {
      const result = await focusTerminalWindow({});

      expect(result).toBe(false);
    });

    it('returns true when xdotool succeeds', async () => {
      mockExecSync.mockReturnValue(Buffer.from(''));

      const result = await focusTerminalWindow({ pid: 1234 });

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('xdotool search --pid 1234 windowactivate'),
        expect.any(Object),
      );
    });

    it('falls back to wmctrl when xdotool fails', async () => {
      mockExecSync
        .mockImplementationOnce(() => { throw new Error('xdotool not found'); })
        .mockReturnValueOnce(Buffer.from(''));

      const result = await focusTerminalWindow({ pid: 1234 });

      expect(result).toBe(true);
      const secondCmd = mockExecSync.mock.calls[1][0] as string;
      expect(secondCmd).toContain('wmctrl');
      expect(secondCmd).toContain('1234');
    });

    it('returns false when both xdotool and wmctrl fail', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = await focusTerminalWindow({ pid: 1234 });

      expect(result).toBe(false);
    });
  });
});
