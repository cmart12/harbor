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
 * Launch a Copilot CLI agent session in interactive mode (-i) for a specific
 * text selection on the canvas. A prompt file is written so the user can
 * reference it, and the initial message is passed via stdin.
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

  // Read canvas content for the agent prompt
  const canvasContent = readCanvas(workspaceRoot, folder);

  const agentId = uuidv4();
  const now = new Date().toISOString();

  // Build the initial prompt the user sees in the interactive session
  const prompt = `Read the canvas at canvas.md for full context. Address the following selected text:\n\n${selectedText}`;

  const agent: CanvasAgent = {
    id: agentId,
    intent_id: intentId,
    selected_text: selectedText,
    session_id: agentId, // use agent ID as session identifier
    pid: null,
    status: 'running',
    created_at: now,
    updated_at: now,
  };

  // Launch copilot -i in terminal
  const pid = launchInteractive(cli, cwd, prompt);
  agent.pid = pid;

  // Record in database
  createCanvasAgent(agent);

  console.log(`[canvas-agent] Launched interactive agent ${agentId} for intent ${intentId} (PID ${pid || 'unknown'})`);
  return { success: true, agent };
}

function launchInteractive(cli: string, cwd: string, prompt: string): number | null {
  try {
    if (process.platform === 'darwin') {
      return launchMac(cli, cwd, prompt);
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

function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

function launchMac(cli: string, cwd: string, prompt: string): number | null {
  const escapedCwd = shellEscape(cwd);
  const escapedCli = shellEscape(cli);
  // Escape prompt for shell: use $'...' syntax for safe embedding
  const escapedPrompt = prompt.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  const script = `tell application "Terminal"
    do script "cd '${escapedCwd}' && echo $'${escapedPrompt}' | '${escapedCli}' -i"
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
      const pid = parseInt(
        execSync(`pgrep -nf "copilot.*-i"`, { timeout: 3000 }).toString().trim()
      );
      if (pid) {
        const db = require('./database').getDatabase();
        db.prepare('UPDATE canvas_agents SET pid = ? WHERE pid = 0 OR pid IS NULL ORDER BY created_at DESC LIMIT 1').run(pid);
      }
    } catch { /* process may not have started yet */ }
  }, 2000);

  return 0;
}

function launchWindows(cli: string, cwd: string, prompt: string): number | null {
  const safePrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, ' ');
  const copilotCmd = `echo "${safePrompt}" | "${cli}" -i`;
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
  const escapedPrompt = prompt.replace(/'/g, "'\\''").replace(/\n/g, '\\n');
  const command = `cd '${shellEscape(cwd)}' && echo $'${escapedPrompt}' | '${shellEscape(cli)}' -i`;
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
