/**
 * Cross-platform terminal launcher.
 * Consolidates terminal launching logic from session.ts and canvas-agent.ts.
 */

import { spawn, execSync } from 'child_process';

export interface TerminalLaunchOptions {
  /** Full command string to execute (e.g. the CLI path) */
  command: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Working directory for the terminal */
  cwd: string;
  /** Optional window/tab title */
  title?: string;
  /** Optional file path to touch when the command exits (exit signal) */
  signalPath?: string;
}

export interface TerminalLaunchResult {
  /** PID of the launched process (0 on macOS where real PID is resolved async) */
  pid?: number;
}

/**
 * Launch a command in the platform's native terminal.
 * - macOS: uses AppleScript to open Terminal.app
 * - Windows: uses PowerShell to open cmd.exe
 * - Linux: tries common terminals (gnome-terminal, konsole, xfce4-terminal, xterm, etc.)
 */
export async function launchInTerminal(options: TerminalLaunchOptions): Promise<TerminalLaunchResult> {
  switch (process.platform) {
    case 'darwin':
      return launchMacOS(options);
    case 'win32':
      return launchWindows(options);
    default:
      return launchLinux(options);
  }
}

// ── Shell escaping ──────────────────────────────────────

/** Escape a string for use inside single-quoted POSIX shell arguments */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Escape a string for use inside a double-quoted shell context
 * (backslash, double-quote, backtick, dollar)
 */
export function shellEscapeDouble(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

/** Escape a string for use inside PowerShell single-quoted strings (double the quotes) */
export function powershellEscape(s: string): string {
  return s.replace(/'/g, "''");
}

// ── Build the full command string from options ──────────

function buildCommandString(options: TerminalLaunchOptions): string {
  const parts = [options.command, ...(options.args || [])];
  return parts.join(' ');
}

// ── macOS: AppleScript + Terminal.app ───────────────────

function launchMacOS(options: TerminalLaunchOptions): TerminalLaunchResult {
  const escapedCwd = options.cwd.replace(/'/g, "'\\''");
  const fullCmd = buildCommandString(options);
  const escapedCmd = fullCmd.replace(/'/g, "'\\''");
  const exitSignal = options.signalPath
    ? ` ; touch '${options.signalPath.replace(/'/g, "'\\''")}'`
    : '';

  const script = `tell application "Terminal"
    do script "cd '${escapedCwd}' && ${escapedCmd}${exitSignal}"
    activate
  end tell`;

  try {
    execSync(`osascript -e '${script}'`, { timeout: 10_000 });
  } catch (err) {
    console.error('[platform/terminal] macOS launch failed:', err);
    return {};
  }

  // On macOS we cannot get the PID synchronously because Terminal.app spawns
  // the shell process asynchronously. Return pid=0 as a placeholder — callers
  // that need the real PID should poll with pgrep.
  return { pid: 0 };
}

// ── Windows: PowerShell + cmd.exe ───────────────────────

function launchWindows(options: TerminalLaunchOptions): TerminalLaunchResult {
  const fullCmd = buildCommandString(options);
  const exitSignal = options.signalPath
    ? ` & echo.>"${options.signalPath.replace(/\\/g, '\\\\')}"`
    : '';
  const cmdArg = fullCmd + exitSignal;

  const safeCwd = powershellEscape(options.cwd);
  const safeCmdArg = powershellEscape(cmdArg);

  try {
    const output = execSync(
      `powershell -NoProfile -Command "$p = Start-Process cmd.exe -ArgumentList '/k ${safeCmdArg}' -WorkingDirectory '${safeCwd}' -PassThru; $p.Id"`,
      { windowsHide: true, timeout: 10_000 },
    )
      .toString()
      .trim();

    const pid = parseInt(output, 10);
    if (pid && !isNaN(pid)) {
      return { pid };
    }
  } catch (err) {
    console.error('[platform/terminal] Windows launch failed:', err);
  }
  return {};
}

// ── Linux: try common terminal emulators ────────────────

interface LinuxLauncher {
  cmd: string;
  buildArgs: (shellCommand: string) => string[];
}

const LINUX_LAUNCHERS: LinuxLauncher[] = [
  {
    cmd: 'gnome-terminal',
    buildArgs: (c) => ['--', 'bash', '-c', c],
  },
  {
    cmd: 'konsole',
    buildArgs: (c) => ['-e', 'bash', '-c', c],
  },
  {
    cmd: 'xfce4-terminal',
    buildArgs: (c) => ['-e', `bash -c ${shellEscape(c)}`],
  },
  {
    cmd: 'x-terminal-emulator',
    buildArgs: (c) => ['-e', `bash -c ${shellEscape(c)}`],
  },
  {
    cmd: 'xterm',
    buildArgs: (c) => ['-e', `bash -c ${shellEscape(c)}`],
  },
];

function launchLinux(options: TerminalLaunchOptions): TerminalLaunchResult {
  const escapedCwd = shellEscape(options.cwd);
  const fullCmd = buildCommandString(options);
  const exitSignal = options.signalPath
    ? ` ; touch ${shellEscape(options.signalPath)}`
    : '';
  const command = `cd ${escapedCwd} && ${fullCmd}${exitSignal}`;

  for (const launcher of LINUX_LAUNCHERS) {
    try {
      execSync(`which ${launcher.cmd}`, { timeout: 2_000, stdio: 'ignore' });

      const proc = spawn(launcher.cmd, launcher.buildArgs(command), {
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();

      if (proc.pid) {
        return { pid: proc.pid };
      }
    } catch {
      continue;
    }
  }

  console.error('[platform/terminal] No terminal emulator found on Linux');
  return {};
}
