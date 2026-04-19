import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getIntent, setIntentSessionId } from './database';

// Per-intent launch lock to prevent duplicate terminals
const launching = new Set<string>();

let copilotPath: string | null = null;
let copilotChecked = false;

export interface LaunchResult {
  success: boolean;
  error?: string;
  sessionId?: string;
}

/** Find the copilot CLI by checking known locations and PATH */
function findCopilotCli(): string | null {
  // On Windows, check common npm global install locations
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.APPDATA || '', 'npm', 'copilot.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'npm', 'copilot.cmd'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }

  // Try `where` (Windows) or `which` (Unix) to find it in PATH
  try {
    const cmd = process.platform === 'win32' ? 'where.exe copilot' : 'which copilot';
    const result = execSync(cmd, { windowsHide: true, timeout: 5000 }).toString().trim();
    const firstLine = result.split(/\r?\n/)[0];
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {
    // Not found via where/which
  }

  return null;
}

/** Probe for copilot CLI availability (cached after first check) */
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

/** Launch a Copilot CLI session for an intent */
export async function launchSession(intentId: string, workspaceRoot: string): Promise<LaunchResult> {
  // Launch lock
  if (launching.has(intentId)) {
    return { success: false, error: 'Session is already launching' };
  }

  // Validate workspace
  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    return { success: false, error: 'Workspace directory does not exist' };
  }

  // Check CLI availability
  const cli = await checkCopilotCli();
  if (!cli) {
    return { success: false, error: 'Copilot CLI not found. Install it with: npm install -g @githubnext/github-copilot-cli' };
  }

  launching.add(intentId);

  try {
    const intent = getIntent(intentId);
    if (!intent) {
      return { success: false, error: 'Intent not found' };
    }

    // Get or create session ID
    let sessionId = intent.session_id;
    if (!sessionId) {
      sessionId = uuidv4();
      setIntentSessionId(intentId, sessionId);
    }

    // Launch in terminal
    const launched = launchInTerminal(cli, sessionId, workspaceRoot);
    if (!launched) {
      return { success: false, error: 'Failed to open terminal' };
    }

    return { success: true, sessionId };
  } finally {
    // Release lock after a brief delay to prevent rapid double-clicks
    setTimeout(() => launching.delete(intentId), 2000);
  }
}

/** Platform-specific terminal launch */
function launchInTerminal(cli: string, sessionId: string, cwd: string): boolean {
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
    return false;
  }
}

function launchWindows(cli: string, sessionId: string, cwd: string): boolean {
  const copilotArgs = `--resume=${sessionId}`;

  // Try Windows Terminal first, fall back to cmd
  try {
    // Check if wt.exe is available
    execSync('where.exe wt.exe', { windowsHide: true, timeout: 3000 });
    spawn('wt.exe', ['new-tab', '-d', cwd, cli, copilotArgs], {
      detached: true,
      stdio: 'ignore',
      shell: false,
    }).unref();
    console.log(`[session] Launched in Windows Terminal: ${sessionId}`);
    return true;
  } catch {
    // Windows Terminal not available, fall back
  }

  // Fallback: cmd.exe — use shell:true so .cmd files resolve properly
  spawn('cmd.exe', ['/c', 'start', '""', '/D', cwd, 'cmd.exe', '/k', `"${cli}" ${copilotArgs}`], {
    detached: true,
    stdio: 'ignore',
    shell: false,
  }).unref();
  console.log(`[session] Launched in cmd.exe: ${sessionId}`);
  return true;
}

function launchMac(cli: string, sessionId: string, cwd: string): boolean {
  const cmd = `cd ${shellEscape(cwd)} && ${cli} --resume=${sessionId}`;
  spawn('open', ['-a', 'Terminal', '--args', '-e', cmd], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  console.log(`[session] Launched in Terminal.app: ${sessionId}`);
  return true;
}

function launchLinux(cli: string, sessionId: string, cwd: string): boolean {
  // Try common terminal emulators
  const terminals = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'];
  const cmd = `cd ${shellEscape(cwd)} && ${cli} --resume=${sessionId}`;

  for (const term of terminals) {
    try {
      spawn(term, ['-e', `bash -c ${shellEscape(cmd)}`], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      console.log(`[session] Launched in ${term}: ${sessionId}`);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
