import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getIntent, assignIntentFolder, createCanvasAgent } from './database';
import { checkCopilotCli } from './session';
import { createIntentFolder, readCanvas } from './workspace';
import { CanvasAgent } from '../shared/types';

export interface AgentLaunchResult {
  success: boolean;
  agent?: CanvasAgent;
  error?: string;
}

/**
 * Launch a Copilot CLI session in interactive mode (-i) for a specific
 * text selection on the canvas. The workspace dir is the intent folder
 * so copilot can read canvas.md directly.
 */
export async function launchCanvasAgent(
  intentId: string,
  selectedText: string,
  workspaceRoot: string
): Promise<AgentLaunchResult> {
  const cli = await checkCopilotCli();
  if (!cli) {
    return { success: false, error: 'Copilot CLI not found' };
  }

  const intent = getIntent(intentId);
  if (!intent) {
    return { success: false, error: 'Intent not found' };
  }

  // Ensure intent has a workspace folder
  let folder = intent.folder;
  if (!folder) {
    folder = createIntentFolder(workspaceRoot, intentId, intent.description);
    assignIntentFolder(intentId, folder);
  }

  const cwd = path.join(workspaceRoot, folder);
  if (!fs.existsSync(cwd)) {
    fs.mkdirSync(cwd, { recursive: true });
  }

  const agentId = uuidv4();
  const now = new Date().toISOString();

  const agent: CanvasAgent = {
    id: agentId,
    intent_id: intentId,
    selected_text: selectedText,
    session_id: agentId,
    pid: null,
    status: 'running',
    created_at: now,
    updated_at: now,
  };

  // Build the prompt for copilot -i
  const prompt = `Read canvas.md for full context, then address this: ${selectedText}`;

  // Launch copilot -i in terminal
  const pid = launchInteractive(cli, cwd, agentId, prompt);
  agent.pid = pid;

  // Record in database
  createCanvasAgent(agent);

  console.log(`[canvas-agent] Launched interactive agent ${agentId} for intent ${intentId} (PID ${pid || 'unknown'})`);
  return { success: true, agent };
}

function launchInteractive(cli: string, cwd: string, agentId: string, prompt: string): number | null {
  try {
    if (process.platform === 'darwin') {
      return launchMac(cli, cwd, agentId, prompt);
    } else if (process.platform === 'win32') {
      return launchWindows(cli, cwd, prompt);
    } else {
      return launchLinux(cli, cwd, prompt);
    }
  } catch (err) {
    console.error('[canvas-agent] Terminal launch failed:', err);
    return null;
  }
}

function launchMac(cli: string, cwd: string, agentId: string, prompt: string): number | null {
  const escapedCwd = cwd.replace(/'/g, "'\\''");
  const escapedCli = cli.replace(/'/g, "'\\''");
  // Escape prompt for shell double-quote context
  const escapedPrompt = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  const script = `tell application "Terminal"
    do script "cd '${escapedCwd}' && '${escapedCli}' -i \\"${escapedPrompt}\\""
    activate
  end tell`;

  try {
    execSync(`osascript -e '${script}'`, { timeout: 10000 });
  } catch (err) {
    console.error('[canvas-agent] macOS launch failed:', err);
    return null;
  }

  // Try to find the PID async
  setTimeout(() => {
    try {
      const result = execSync(`pgrep -nf "copilot.*-i"`, { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      const pid = parseInt(result);
      if (pid && !isNaN(pid)) {
        const db = require('./database').getDatabase();
        db.prepare('UPDATE canvas_agents SET pid = ? WHERE id = ?').run(pid, agentId);
      }
    } catch { /* process may not have started yet */ }
  }, 2000);

  return 0;
}

function launchWindows(cli: string, cwd: string, prompt: string): number | null {
  const safePrompt = prompt.replace(/"/g, '\\"');
  const copilotCmd = `"${cli}" -i "${safePrompt}"`;
  try {
    const output = execSync(
      `powershell -NoProfile -Command "$p = Start-Process cmd.exe -ArgumentList '/k ${copilotCmd.replace(/'/g, "''")}' -WorkingDirectory '${cwd.replace(/'/g, "''")}' -PassThru; $p.Id"`,
      { windowsHide: true, timeout: 10000 }
    ).toString().trim();
    const pid = parseInt(output);
    return pid && !isNaN(pid) ? pid : null;
  } catch {
    return null;
  }
}

function launchLinux(cli: string, cwd: string, prompt: string): number | null {
  const escapedCwd = cwd.replace(/'/g, "'\\''");
  const escapedCli = cli.replace(/'/g, "'\\''");
  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const command = `cd '${escapedCwd}' && '${escapedCli}' -i '${escapedPrompt}'`;
  const launchers = [
    { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', command] },
    { cmd: 'xterm', args: ['-e', `bash -c "${command}"`] },
  ];

  for (const launcher of launchers) {
    try {
      execSync(`which ${launcher.cmd}`, { timeout: 2000, stdio: 'ignore' });
      const proc = spawn(launcher.cmd, launcher.args, { detached: true, stdio: 'ignore' });
      proc.unref();
      return proc.pid || null;
    } catch { continue; }
  }
  return null;
}
