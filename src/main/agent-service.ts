import { CopilotSession, approveAll } from '@github/copilot-sdk';
import { v4 as uuid } from 'uuid';
import { BrowserWindow } from 'electron';
import { getCopilotClient } from './ai';
import { createCanvasAgent, updateCanvasAgentStatus } from './database';
import { CanvasAgent, AgentAnchor } from '../shared/types';
import { readCanvas } from './workspace';
import { getConfig } from './config';
import { launchSessionInTerminal } from './session';
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
  intentFolder: string
): Promise<{ agentId: string; sessionId: string } | { error: string }> {
  const client = getCopilotClient();
  if (!client) {
    return { error: 'Copilot SDK not initialized' };
  }

  const agentId = uuid();
  const workingDir = path.join(workspaceRoot, intentFolder);

  try {
    const session = await client.createSession({
      workingDirectory: workingDir,
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
        content: `\nThe user selected the following text from their canvas document and wants you to work on it:\n\n---\n${selectedText}\n---\n\nThe full canvas document is available as canvas.md in the working directory.`,
      },
    });

    const sessionId = (session as any).sessionId || agentId;

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

    // Persist to DB
    createCanvasAgent({
      id: agentId,
      intent_id: intentId,
      selected_text: selectedText,
      session_id: sessionId,
      pid: null,
      status: 'running',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Set up event listeners
    session.on('assistant.message', (event: any) => {
      record.summary = truncate(event.content || event.message || 'Agent responded', 100);
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
  const record = agents.get(agentId);
  if (!record) return { error: 'Agent not found' };

  const config = getConfig();
  const workspaceRoot = config.workspace;
  if (!workspaceRoot) return { error: 'No workspace' };

  try {
    await launchSessionInTerminal(record.sessionId, workspaceRoot);
    return {};
  } catch (err: any) {
    return { error: err.message || 'Failed to open CLI' };
  }
}

function findBySessionId(sessionId: string): AgentRecord | undefined {
  for (const record of agents.values()) {
    if (record.sessionId === sessionId) return record;
  }
  return undefined;
}

function updateAgentStatus(record: AgentRecord): void {
  try {
    updateCanvasAgentStatus(record.agentId, record.status);
  } catch {
    // DB update failure is non-fatal
  }
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
}
