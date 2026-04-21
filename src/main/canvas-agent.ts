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
 * Launch a Copilot CLI agent session for a specific text selection on the canvas.
 * The agent is given a prompt to read the canvas and address the selected text.
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

  // Create a prompt file for the agent
  const agentId = uuidv4();
  const sessionId = uuidv4();
  const promptDir = path.join(cwd, '.intent-agents');
  if (!fs.existsSync(promptDir)) {
    fs.mkdirSync(promptDir, { recursive: true });
  }

  const promptFile = path.join(promptDir, `${agentId}.md`);
  const promptContent = `# Agent Task

You are working on an intent canvas. The user has selected specific text and asked you to address it.

## Full Canvas Content
\`\`\`
${canvasContent}
\`\`\`

## Selected Text to Address
\`\`\`
${selectedText}
\`\`\`

## Instructions
- Read the full canvas for context
- Focus specifically on the selected text above
- Address what the selected text is asking for, or work on the task it describes
- Create any files or code needed in this directory
- Be thorough and complete
`;

  fs.writeFileSync(promptFile, promptContent, 'utf-8');

  const now = new Date().toISOString();
  const agent: CanvasAgent = {
    id: agentId,
    intent_id: intentId,
    selected_text: selectedText,
    session_id: sessionId,
    pid: null,
    status: 'running',
    created_at: now,
    updated_at: now,
  };

  // Launch in terminal
  const pid = launchAgentInTerminal(cli, sessionId, cwd, promptFile);
  agent.pid = pid;

  // Record in database
  createCanvasAgent(agent);

  console.log(`[canvas-agent] Launched agent ${agentId} for intent ${intentId} (PID ${pid || 'unknown'})`);
  return { success: true, agent };
}

function launchAgentInTerminal(cli: string, sessionId: string, cwd: string, promptFile: string): number | null {
  try {
    if (process.platform === 'darwin') {
      return launchMac(cli, sessionId, cwd, promptFile);
    } else if (process.platform === 'win32') {
      return launchWindows(cli, sessionId, cwd, promptFile);
    } else {
      return launchLinux(cli, sessionId, cwd, promptFile);
    }
  } catch (err) {
    console.error('[canvas-agent] Terminal launch failed:', err);
    return null;
  }
}

function launchMac(cli: string, sessionId: string, cwd: string, promptFile: string): number | null {
  const escapedCwd = cwd.replace(/'/g, "'\\''");
  const escapedCli = cli.replace(/'/g, "'\\''");
  const escapedPrompt = promptFile.replace(/'/g, "'\\''");
  const script = `tell application "Terminal"
    do script "cd '${escapedCwd}' && '${escapedCli}' --resume=${sessionId} < '${escapedPrompt}'"
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
        execSync(`pgrep -nf "resume=${sessionId}"`, { timeout: 3000 }).toString().trim()
      );
      if (pid) {
        // Update via import to avoid circular deps
        const { updateCanvasAgentStatus } = require('./database');
        // Just update PID, keep running status
        const db = require('./database').getDatabase();
        db.prepare('UPDATE canvas_agents SET pid = ? WHERE session_id = ?').run(pid, sessionId);
      }
    } catch { /* process may not have started yet */ }
  }, 2000);

  return 0;
}

function launchWindows(cli: string, sessionId: string, cwd: string, promptFile: string): number | null {
  const copilotCmd = `"${cli}" --resume=${sessionId} < "${promptFile}"`;
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

function launchLinux(cli: string, sessionId: string, cwd: string, promptFile: string): number | null {
  const command = `cd '${cwd.replace(/'/g, "'\\''")}' && '${cli.replace(/'/g, "'\\''")}' --resume=${sessionId} < '${promptFile.replace(/'/g, "'\\''")}'`;
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
