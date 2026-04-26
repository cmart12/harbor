import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────

const { mockExecSync, mockSpawn } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
  spawn: mockSpawn,
}));

import {
  launchInTerminal,
  shellEscape,
  shellEscapeDouble,
  powershellEscape,
  type TerminalLaunchOptions,
} from './terminal';

// ── Helpers ─────────────────────────────────────────────

const baseOptions: TerminalLaunchOptions = {
  command: '/usr/local/bin/copilot',
  args: ['--resume=abc-123'],
  cwd: '/home/user/project',
};

function stubPlatform(value: string) {
  return vi.spyOn(process, 'platform', 'get').mockReturnValue(value as NodeJS.Platform);
}

describe('shellEscape', () => {
  it('wraps strings in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it('handles multiple single quotes', () => {
    expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  it('handles empty string', () => {
    expect(shellEscape('')).toBe("''");
  });

  it('handles paths with spaces', () => {
    expect(shellEscape('/my path/to dir')).toBe("'/my path/to dir'");
  });
});

describe('shellEscapeDouble', () => {
  it('escapes backslashes', () => {
    expect(shellEscapeDouble('a\\b')).toBe('a\\\\b');
  });

  it('escapes double quotes', () => {
    expect(shellEscapeDouble('say "hi"')).toBe('say \\"hi\\"');
  });

  it('escapes backticks and dollar signs', () => {
    expect(shellEscapeDouble('`$HOME`')).toBe('\\`\\$HOME\\`');
  });
});

describe('powershellEscape', () => {
  it('doubles single quotes', () => {
    expect(powershellEscape("it's here")).toBe("it''s here");
  });

  it('returns plain string if no quotes', () => {
    expect(powershellEscape('hello')).toBe('hello');
  });
});

describe('launchInTerminal', () => {
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

    it('calls osascript with the correct AppleScript', async () => {
      mockExecSync.mockReturnValue(Buffer.from(''));

      const result = await launchInTerminal(baseOptions);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      const cmd = mockExecSync.mock.calls[0][0] as string;
      expect(cmd).toContain('osascript');
      expect(cmd).toContain('Terminal');
      expect(cmd).toContain(baseOptions.cwd);
      expect(cmd).toContain('--resume=abc-123');
      expect(result.pid).toBe(0);
    });

    it('includes exit signal when signalPath is provided', async () => {
      mockExecSync.mockReturnValue(Buffer.from(''));

      await launchInTerminal({ ...baseOptions, signalPath: '/path/to/signal' });

      const cmd = mockExecSync.mock.calls[0][0] as string;
      expect(cmd).toContain('touch');
      expect(cmd).toContain('/path/to/signal');
    });

    it('returns empty result on failure', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('osascript failed');
      });

      const result = await launchInTerminal(baseOptions);

      expect(result.pid).toBeUndefined();
    });
  });

  // ── Windows ─────────────────────────────────────────

  describe('Windows', () => {
    beforeEach(() => {
      platformSpy = stubPlatform('win32');
    });

    it('calls powershell Start-Process and returns PID', async () => {
      mockExecSync.mockReturnValue(Buffer.from('12345'));

      const result = await launchInTerminal(baseOptions);

      expect(mockExecSync).toHaveBeenCalledTimes(1);
      const cmd = mockExecSync.mock.calls[0][0] as string;
      expect(cmd).toContain('powershell');
      expect(cmd).toContain('Start-Process cmd.exe');
      expect(result.pid).toBe(12345);
    });

    it('returns empty result when powershell fails', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('powershell failed');
      });

      const result = await launchInTerminal(baseOptions);

      expect(result.pid).toBeUndefined();
    });

    it('returns empty result when output is not a number', async () => {
      mockExecSync.mockReturnValue(Buffer.from('not-a-pid'));

      const result = await launchInTerminal(baseOptions);

      expect(result.pid).toBeUndefined();
    });
  });

  // ── Linux ───────────────────────────────────────────

  describe('Linux', () => {
    beforeEach(() => {
      platformSpy = stubPlatform('linux');
    });

    it('tries gnome-terminal first and returns PID', async () => {
      // `which gnome-terminal` succeeds
      mockExecSync.mockReturnValue(Buffer.from('/usr/bin/gnome-terminal'));
      const mockProc = { pid: 9999, unref: vi.fn() };
      mockSpawn.mockReturnValue(mockProc);

      const result = await launchInTerminal(baseOptions);

      expect(mockExecSync).toHaveBeenCalledWith(
        'which gnome-terminal',
        expect.any(Object),
      );
      expect(mockSpawn).toHaveBeenCalledWith(
        'gnome-terminal',
        expect.arrayContaining(['--', 'bash', '-c', expect.stringContaining('--resume=abc-123')]),
        expect.objectContaining({ detached: true, stdio: 'ignore' }),
      );
      expect(result.pid).toBe(9999);
    });

    it('falls back to next launcher when first is not found', async () => {
      // gnome-terminal not found, konsole found
      mockExecSync
        .mockImplementationOnce(() => { throw new Error('not found'); }) // gnome-terminal
        .mockReturnValueOnce(Buffer.from('/usr/bin/konsole'));           // konsole
      const mockProc = { pid: 7777, unref: vi.fn() };
      mockSpawn.mockReturnValue(mockProc);

      const result = await launchInTerminal(baseOptions);

      expect(mockSpawn).toHaveBeenCalledWith(
        'konsole',
        expect.any(Array),
        expect.any(Object),
      );
      expect(result.pid).toBe(7777);
    });

    it('returns empty result when no terminal is found', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = await launchInTerminal(baseOptions);

      expect(result.pid).toBeUndefined();
    });

    it('includes exit signal path in command', async () => {
      mockExecSync.mockReturnValue(Buffer.from('/usr/bin/gnome-terminal'));
      const mockProc = { pid: 5555, unref: vi.fn() };
      mockSpawn.mockReturnValue(mockProc);

      await launchInTerminal({ ...baseOptions, signalPath: '/sig' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      const shellCmd = args[args.length - 1];
      expect(shellCmd).toContain('touch');
      expect(shellCmd).toContain('/sig');
    });
  });
});
