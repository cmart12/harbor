import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getIntent, setIntentSessionId } from './database';

// Per-intent launch lock to prevent duplicate terminals
const launching = new Set<string>();

// Track running terminal processes: intentId → session info
interface TrackedSession {
  pid: number | null;
  sessionId: string;
}
const runningProcesses = new Map<string, TrackedSession>();

let copilotPath: string | null = null;
let copilotChecked = false;

export interface LaunchResult {
  success: boolean;
  error?: string;
  sessionId?: string;
}

// ── CLI discovery ───────────────────────────────────────

function findCopilotCli(): string | null {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.APPDATA || '', 'npm', 'copilot.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'npm', 'copilot.cmd'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }

  // macOS/Linux: check common paths
  if (process.platform !== 'win32') {
    const home = process.env.HOME || '';
    const candidates = [
      '/usr/local/bin/copilot',
      '/opt/homebrew/bin/copilot',
      path.join(home, '.npm-global', 'bin', 'copilot'),
      path.join(home, '.nvm', 'current', 'bin', 'copilot'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }

  try {
    const cmd = process.platform === 'win32' ? 'where.exe copilot' : 'which copilot';
    const result = execSync(cmd, { windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const firstLine = result.split(/\r?\n/)[0];
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {
    // Not found
  }

  return null;
}

export async function checkCopilotCli(): Promise<string | null> {
  if (copilotChecked) return copilotPath;
  copilotChecked = true;

  copilotPath = findCopilotCli();
  if (copilotPath) {
    console.log(`[session] Copilot CLI found at: ${copilotPath}`);
  } else {
    console.warn('[session] Copilot CLI not found');
  }
  return copilotPath;
}

// ── Process tracking ────────────────────────────────────

/** Check if a process is still running by PID */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Check if a copilot session is running by searching for its resume arg */
function isSessionProcessRunning(sessionId: string): boolean {
  try {
    if (process.platform === 'win32') {
      const result = execSync(
        `wmic process where "CommandLine like '%--resume=${sessionId}%'" get ProcessId /format:list`,
        { windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
      ).toString();
      return result.includes('ProcessId=');
    } else {
      execSync(`pgrep -f "resume=${sessionId}"`, { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
      return true;
    }
  } catch {
    return false;
  }
}

/** Check if a tracked session is still running */
function isTrackedSessionAlive(tracked: TrackedSession): boolean {
  if (tracked.pid && isProcessAlive(tracked.pid)) return true;
  return isSessionProcessRunning(tracked.sessionId);
}

/** Get intent IDs that have active running terminal processes */
export function getActiveSessionIntentIds(): string[] {
  const active: string[] = [];
  for (const [intentId, tracked] of runningProcesses) {
    if (isTrackedSessionAlive(tracked)) {
      active.push(intentId);
    } else {
      runningProcesses.delete(intentId);
    }
  }
  return active;
}

// ── Window focus (platform-specific) ────────────────────

function focusWindow(tracked: TrackedSession): boolean {
  try {
    if (process.platform === 'win32') {
      return focusWindowWindows(tracked);
    } else if (process.platform === 'darwin') {
      return focusWindowMac(tracked);
    } else {
      return focusWindowLinux(tracked);
    }
  } catch {
    return false;
  }
}

function focusWindowWindows(tracked: TrackedSession): boolean {
  if (!tracked.pid) return false;
  try {
    const result = execSync(
      `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).AppActivate(${tracked.pid})"`,
      { windowsHide: true, timeout: 3000 }
    ).toString().trim();
    return result === 'True';
  } catch {
    return false;
  }
}

function focusWindowMac(tracked: TrackedSession): boolean {
  // Use AppleScript to find and activate the Terminal window running this session
  const script = `
    tell application "Terminal"
      set found to false
      repeat with w in windows
        if name of w contains "${tracked.sessionId}" or name of w contains "copilot" then
          set index of w to 1
          set found to true
          exit repeat
        end if
      end repeat
      if found then
        activate
        return "True"
      else
        -- Fallback: just activate Terminal if the session process is running
        activate
        return "Fallback"
      end if
    end tell`;
  try {
    const result = execSync(`osascript -e '${script}'`, { timeout: 5000 }).toString().trim();
    return result === 'True' || result === 'Fallback';
  } catch {
    return false;
  }
}

function focusWindowLinux(tracked: TrackedSession): boolean {
  // Try xdotool first (most common), then wmctrl
  try {
    execSync(`xdotool search --pid ${tracked.pid} windowactivate`, { timeout: 3000, stdio: 'ignore' });
    return true;
  } catch { /* xdotool failed or not installed */ }

  try {
    execSync(`wmctrl -ia $(wmctrl -lp | grep ${tracked.pid} | head -1 | awk '{print $1}')`, { timeout: 3000, stdio: 'ignore' });
    return true;
  } catch { /* wmctrl failed or not installed */ }

  return false;
}

// ── Launch / reactivate ─────────────────────────────────

export async function launchSession(intentId: string, workspaceRoot: string): Promise<LaunchResult> {
  // Check if there's already a running process — bring it to foreground
  const existing = runningProcesses.get(intentId);
  if (existing && isTrackedSessionAlive(existing)) {
    const focused = focusWindow(existing);
    if (focused) {
      console.log(`[session] Reactivated existing terminal for ${intentId}`);
      return { success: true, sessionId: existing.sessionId };
    }
    // Process alive but couldn't focus — clear and relaunch
    runningProcesses.delete(intentId);
  }

  // Launch lock
  if (launching.has(intentId)) {
    return { success: false, error: 'Session is already launching' };
  }

  // Validate workspace
  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    return { success: false, error: 'Workspace directory does not exist' };
  }

  const cli = await checkCopilotCli();
  if (!cli) {
    return { success: false, error: 'Copilot CLI not found. Ensure it is installed and in your PATH.' };
  }

  launching.add(intentId);

  try {
    const intent = getIntent(intentId);
    if (!intent) {
      return { success: false, error: 'Intent not found' };
    }

    let sessionId = intent.session_id;
    if (!sessionId) {
      sessionId = uuidv4();
      setIntentSessionId(intentId, sessionId);
    }

    const pid = launchInTerminal(cli, sessionId, workspaceRoot);
    if (pid === null) {
      return { success: false, error: 'Failed to open terminal' };
    }

    runningProcesses.set(intentId, { pid, sessionId });
    console.log(`[session] Launched terminal for ${intentId} (PID ${pid || 'unknown'})`);
    return { success: true, sessionId };
  } finally {
    setTimeout(() => launching.delete(intentId), 2000);
  }
}

// ── Platform-specific terminal launch ───────────────────

function launchInTerminal(cli: string, sessionId: string, cwd: string): number | null {
  try {
    if (process.platform === 'win32') {
      return launchWindows(cli, sessionId, cwd);
    } else if (process.platform === 'darwin') {
      return launchMac(cli, sessionId, cwd);
    } else {
      return launchLinux(cli, sessionId, cwd);
    }
  } catch (err) {
    console.error('[session] Terminal launch failed:', err);
    return null;
  }
}

function launchWindows(cli: string, sessionId: string, cwd: string): number | null {
  // Use cmd.exe directly so we get a trackable PID for window reactivation
  const proc = spawn('cmd.exe', ['/k', `"${cli}" --resume=${sessionId}`], {
    cwd,
    detached: true,
    stdio: 'ignore',
    shell: false,
  });
  proc.unref();
  return proc.pid || null;
}

function launchMac(cli: string, sessionId: string, cwd: string): number | null {
  // Use AppleScript to open a new Terminal window with the command
  // This gives us a proper Terminal.app window that we can find later
  const escapedCwd = cwd.replace(/'/g, "'\\''");
  const escapedCli = cli.replace(/'/g, "'\\''");
  const script = `tell application "Terminal"
    do script "cd '${escapedCwd}' && '${escapedCli}' --resume=${sessionId}"
    activate
  end tell`;

  try {
    execSync(`osascript -e '${script}'`, { timeout: 10000 });
  } catch (err) {
    console.error('[session] macOS launch failed:', err);
    return null;
  }

  // Find the copilot process PID (slight delay for process to start)
  setTimeout(() => {
    try {
      const pid = parseInt(
        execSync(`pgrep -nf "resume=${sessionId}"`, { timeout: 3000 }).toString().trim()
      );
      if (pid) {
        // Update the tracked session with the real PID
        for (const [intentId, tracked] of runningProcesses) {
          if (tracked.sessionId === sessionId) {
            tracked.pid = pid;
            break;
          }
        }
      }
    } catch { /* process may not have started yet */ }
  }, 2000);

  // Return 0 as placeholder — the real PID is updated async above
  return 0;
}

function launchLinux(cli: string, sessionId: string, cwd: string): number | null {
  const escapedCwd = shellEscape(cwd);
  const escapedCli = shellEscape(cli);
  const command = `cd ${escapedCwd} && ${escapedCli} --resume=${sessionId}`;

  // Try terminal emulators in preference order
  const launchers: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', command] },
    { cmd: 'konsole', args: ['-e', 'bash', '-c', command] },
    { cmd: 'xfce4-terminal', args: ['-e', `bash -c ${shellEscape(command)}`] },
    { cmd: 'x-terminal-emulator', args: ['-e', `bash -c ${shellEscape(command)}`] },
    { cmd: 'xterm', args: ['-e', `bash -c ${shellEscape(command)}`] },
  ];

  for (const launcher of launchers) {
    try {
      // Check if terminal exists
      execSync(`which ${launcher.cmd}`, { timeout: 2000, stdio: 'ignore' });

      const proc = spawn(launcher.cmd, launcher.args, {
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();

      if (proc.pid) {
        console.log(`[session] Launched ${launcher.cmd} (PID ${proc.pid}): ${sessionId}`);
        return proc.pid;
      }
    } catch {
      continue;
    }
  }

  console.error('[session] No terminal emulator found on Linux');
  return null;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
