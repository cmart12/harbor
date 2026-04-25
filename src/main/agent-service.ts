import { CopilotSession, approveAll } from '@github/copilot-sdk';
import { v4 as uuid } from 'uuid';
import { BrowserWindow } from 'electron';
import { getCopilotClient } from './ai';
import { createCanvasAgent, updateCanvasAgentStatus, createAgentSession, updateAgentSessionStatus, getAgentSession, listAgentSessions } from './database';
import { CanvasAgent, AgentAnchor, AgentSession } from '../shared/types';
import { readCanvas } from './workspace';
import { getConfig, getConfigValue } from './config';
import { launchSessionInTerminal } from './session';
import { getAllMcpServers } from './mcp';
import * as path from 'path';

export type AgentStatus = 'running' | 'waiting-approval' | 'completed' | 'failed';

interface AgentRecord {
  agentId: string;
  sessionId: string;
  session: CopilotSession;
  intentId: string;
  selectedText: string;
  anchor: AgentAnchor;
  status: AgentStatus;
  pendingApprovalId: string | null;
  summary: string;
}

const agents = new Map<string, AgentRecord>();

/** Build a system prompt fragment describing available CLI tools */
function buildCliToolsPrompt(): string {
  const tools = getConfigValue('cliTools') || [];
  if (tools.length === 0) return '';
  const lines = tools.map(t => `- \`${t.name}\`: ${t.description}`);
  return `\n\nThe following CLI tools may be available in the environment (verify before use):\n${lines.join('\n')}`;
}

function notifyRenderer(channel: string, ...args: any[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

export async function launchAgent(
  intentId: string,
  selectedText: string,
  anchor: AgentAnchor,
  workspaceRoot: string,
  intentFolder: string,
  options?: { repo?: string; model?: string }
): Promise<{ agentId: string; sessionId: string } | { error: string }> {
  const client = getCopilotClient();
  if (!client) {
    return { error: 'Copilot SDK not initialized' };
  }

  const agentId = uuid();
  const workingDir = path.join(workspaceRoot, intentFolder);

  try {
    const mcpServers = getAllMcpServers();
    const cliToolsPrompt = buildCliToolsPrompt();

    const session = await client.createSession({
      workingDirectory: workingDir,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      onPermissionRequest: async (request, invocation) => {
        const record = findBySessionId(invocation.sessionId);
        if (!record) return { kind: 'denied-interactively-by-user' as const };

        // Forward approval request to renderer
        record.status = 'waiting-approval';
        record.pendingApprovalId = request.toolCallId || agentId;
        updateAgentStatus(record);

        notifyRenderer('agent:approval-needed', {
          agentId: record.agentId,
          requestId: record.pendingApprovalId,
          permissionKind: request.kind,
        });

        // Wait for renderer response (stored as a promise)
        return new Promise((resolve) => {
          approvalCallbacks.set(record.pendingApprovalId!, (approved: boolean) => {
            record.pendingApprovalId = null;
            record.status = 'running';
            updateAgentStatus(record);
            resolve(approved
              ? { kind: 'approved' as const }
              : { kind: 'denied-interactively-by-user' as const }
            );
          });
        });
      },
      systemMessage: {
        mode: 'append',
        content: `\nThe user selected the following text from their canvas document and wants you to work on it:\n\n---\n${selectedText}\n---\n\nThe full canvas document is available as canvas.md in the working directory.${cliToolsPrompt}`,
      },
    });

    const sessionId = (session as any).sessionId || agentId;
    const now = new Date().toISOString();

    const record: AgentRecord = {
      agentId,
      sessionId,
      session,
      intentId,
      selectedText,
      anchor,
      status: 'running',
      pendingApprovalId: null,
      summary: 'Starting...',
    };
    agents.set(agentId, record);

    // Persist to DB (both canvas_agents for backward compat + agent_sessions as central registry)
    createCanvasAgent({
      id: agentId,
      intent_id: intentId,
      selected_text: selectedText,
      session_id: sessionId,
      pid: null,
      status: 'running',
      created_at: now,
      updated_at: now,
    });

    createAgentSession({
      id: agentId,
      session_id: sessionId,
      intent_id: intentId,
      prompt: selectedText,
      status: 'running',
      summary: 'Starting...',
      working_dir: workingDir,
      created_at: now,
      updated_at: now,
    });

    // Set up event listeners
    setupAgentEventListeners(session, record);

    // Send the prompt
    await session.send({
      prompt: selectedText,
      attachments: [{ type: 'file' as const, path: path.join(workingDir, 'canvas.md') }],
    });

    return { agentId, sessionId };
  } catch (err: any) {
    return { error: err.message || 'Failed to launch agent' };
  }
}

// Approval callback registry
const approvalCallbacks = new Map<string, (approved: boolean) => void>();

export function approveAgent(agentId: string, requestId: string, approved: boolean): void {
  const cb = approvalCallbacks.get(requestId);
  if (cb) {
    approvalCallbacks.delete(requestId);
    cb(approved);
  }
}

export async function abortAgent(agentId: string): Promise<void> {
  const record = agents.get(agentId);
  if (!record) return;

  try {
    await record.session.abort();
    record.status = 'failed';
    record.summary = 'Aborted by user';
    updateAgentStatus(record);
    notifyRenderer('agent:status-changed', {
      agentId, status: 'failed', summary: record.summary,
    });
  } catch {
    // ignore
  }
}

export function listAgents(intentId: string): Array<{ agentId: string; sessionId: string; status: AgentStatus; summary: string; selectedText: string; anchor: AgentAnchor }> {
  return Array.from(agents.values())
    .filter(a => a.intentId === intentId)
    .map(a => ({
      agentId: a.agentId,
      sessionId: a.sessionId,
      status: a.status,
      summary: a.summary,
      selectedText: a.selectedText,
      anchor: a.anchor,
    }));
}

export function getAgentSessionId(agentId: string): string | null {
  return agents.get(agentId)?.sessionId ?? null;
}

export async function openAgentCli(agentId: string): Promise<{ error?: string }> {
  const config = getConfig();
  const workspaceRoot = config.workspace;
  if (!workspaceRoot) return { error: 'No workspace' };

  // Try live agent first, then fall back to DB
  const record = agents.get(agentId);
  let sessionId: string;
  let cwd: string;

  if (record) {
    sessionId = record.sessionId;
    cwd = workspaceRoot;
  } else {
    // Historical agent — look up from DB
    const persisted = getAgentSession(agentId);
    if (!persisted) return { error: 'Agent not found' };
    sessionId = persisted.session_id;
    cwd = persisted.working_dir || workspaceRoot;
  }

  try {
    await launchSessionInTerminal(sessionId, cwd);
    return {};
  } catch (err: any) {
    return { error: err.message || 'Failed to open CLI' };
  }
}

export async function launchQuickAgent(
  prompt: string,
  workspaceRoot: string,
): Promise<{ agentId: string; sessionId: string } | { error: string }> {
  const client = getCopilotClient();
  if (!client) {
    return { error: 'Copilot SDK not initialized' };
  }

  const agentId = uuid();

  try {
    const mcpServers = getAllMcpServers();
    const cliToolsPrompt = buildCliToolsPrompt();

    const session = await client.createSession({
      workingDirectory: workspaceRoot,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      ...(cliToolsPrompt ? {
        systemMessage: {
          mode: 'append' as const,
          content: cliToolsPrompt,
        },
      } : {}),
      onPermissionRequest: async (request, invocation) => {
        const record = findBySessionId(invocation.sessionId);
        if (!record) return { kind: 'denied-interactively-by-user' as const };

        record.status = 'waiting-approval';
        record.pendingApprovalId = request.toolCallId || agentId;
        updateAgentStatus(record);

        notifyRenderer('agent:approval-needed', {
          agentId: record.agentId,
          requestId: record.pendingApprovalId,
          permissionKind: request.kind,
        });

        return new Promise((resolve) => {
          approvalCallbacks.set(record.pendingApprovalId!, (approved: boolean) => {
            record.pendingApprovalId = null;
            record.status = 'running';
            updateAgentStatus(record);
            resolve(approved
              ? { kind: 'approved' as const }
              : { kind: 'denied-interactively-by-user' as const }
            );
          });
        });
      },
    });

    const sessionId = (session as any).sessionId || agentId;
    const now = new Date().toISOString();

    const record: AgentRecord = {
      agentId,
      sessionId,
      session,
      intentId: '__workspace__',
      selectedText: prompt,
      anchor: { quote: '', prefix: '', suffix: '' },
      status: 'running',
      pendingApprovalId: null,
      summary: 'Starting...',
    };
    agents.set(agentId, record);

    createAgentSession({
      id: agentId,
      session_id: sessionId,
      intent_id: null,
      prompt,
      status: 'running',
      summary: 'Starting...',
      working_dir: workspaceRoot,
      created_at: now,
      updated_at: now,
    });

    setupAgentEventListeners(session, record);

    await session.send({ prompt });

    return { agentId, sessionId };
  } catch (err: any) {
    return { error: err.message || 'Failed to launch agent' };
  }
}

export function listAllAgents(): Array<{ agentId: string; sessionId: string; status: AgentStatus; summary: string; selectedText: string; intentId: string; createdAt: string }> {
  // Read persisted sessions from DB (sorted newest first)
  let persisted: AgentSession[] = [];
  try {
    persisted = listAgentSessions();
  } catch { /* DB may not be initialized */ }

  // Build result: overlay live in-memory state on top of DB records
  const seen = new Set<string>();
  const result: Array<{ agentId: string; sessionId: string; status: AgentStatus; summary: string; selectedText: string; intentId: string; createdAt: string }> = [];

  for (const row of persisted) {
    seen.add(row.id);
    const live = agents.get(row.id);
    result.push({
      agentId: row.id,
      sessionId: row.session_id,
      status: (live?.status ?? row.status) as AgentStatus,
      summary: live?.summary ?? row.summary,
      selectedText: live?.selectedText ?? row.prompt,
      intentId: live?.intentId ?? row.intent_id ?? '__workspace__',
      createdAt: row.created_at,
    });
  }

  // Add any live agents not yet in DB (shouldn't happen, but defensive)
  for (const [id, a] of agents) {
    if (!seen.has(id)) {
      result.push({
        agentId: a.agentId,
        sessionId: a.sessionId,
        status: a.status,
        summary: a.summary,
        selectedText: a.selectedText,
        intentId: a.intentId,
        createdAt: '',
      });
    }
  }

  return result;
}

function findBySessionId(sessionId: string): AgentRecord | undefined {
  for (const record of agents.values()) {
    if (record.sessionId === sessionId) return record;
  }
  return undefined;
}

function setupAgentEventListeners(session: CopilotSession, record: AgentRecord): void {
  const agentId = record.agentId;

  session.on('assistant.message', (event: any) => {
    record.summary = truncate(event.content || event.message || 'Agent responded', 100);
    persistSummary(record);
    notifyRenderer('agent:status-changed', {
      agentId, status: record.status, summary: record.summary,
    });
  });

  session.on('tool.execution_start', (event: any) => {
    record.summary = `Using ${event.toolName || 'tool'}...`;
    notifyRenderer('agent:status-changed', {
      agentId, status: record.status, summary: record.summary,
    });
  });

  session.on('session.idle', () => {
    if (record.status === 'running') {
      record.status = 'completed';
      record.summary = 'Completed';
      updateAgentStatus(record);
      notifyRenderer('agent:completed', { agentId, summary: record.summary });
    }
  });

  session.on('session.error', (event: any) => {
    record.status = 'failed';
    record.summary = `Error: ${event.message || 'Unknown error'}`;
    updateAgentStatus(record);
    notifyRenderer('agent:status-changed', {
      agentId, status: 'failed', summary: record.summary,
    });
  });
}

function persistSummary(record: AgentRecord): void {
  try {
    updateAgentSessionStatus(record.agentId, record.status, record.summary);
  } catch { /* non-fatal */ }
}

function updateAgentStatus(record: AgentRecord): void {
  try {
    updateCanvasAgentStatus(record.agentId, record.status);
  } catch { /* non-fatal */ }
  try {
    updateAgentSessionStatus(record.agentId, record.status, record.summary);
  } catch { /* non-fatal */ }
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
}
