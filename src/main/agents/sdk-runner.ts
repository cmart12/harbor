import { CopilotSession } from '@github/copilot-sdk';
import { v4 as uuid } from 'uuid';
import * as path from 'path';
import { getCopilotClient } from '../ai';
import { AgentAnchor } from '../../shared/types';
import { getConfig, getConfigValue, type AgentPersona } from '../config';
import { getAllMcpServers } from '../mcp';
import { AgentRegistry, truncate } from './agent-registry';
import type { AgentRecord } from './agent-registry';
import { AgentNotifier } from './agent-notifier';
import { AgentPersistence } from './agent-persistence';
import { InteractionBroker } from './interaction-broker';
import type { SubagentTracker } from '../subagent-service';
import { getCustomTools } from '../tools';
import { appendIntentActivity } from '../intent-eventlog';
import { buildSandboxLaunchSetup } from './sandbox-launch';
import { SANDBOX_WORKSPACE_SYSTEM_PROMPT } from './sandbox-policies';

/** Shared dependencies injected from agent-service at init time. */
let registry: AgentRegistry;
let notifier: AgentNotifier;
let persistence: AgentPersistence;
let broker: InteractionBroker;
let subagentTracker: SubagentTracker;

export function initSdkRunner(deps: {
  registry: AgentRegistry;
  notifier: AgentNotifier;
  persistence: AgentPersistence;
  broker: InteractionBroker;
  subagentTracker: SubagentTracker;
}): void {
  registry = deps.registry;
  notifier = deps.notifier;
  persistence = deps.persistence;
  broker = deps.broker;
  subagentTracker = deps.subagentTracker;
}

/** Build a system prompt fragment describing available CLI tools */
export function buildCliToolsPrompt(): string {
  const tools = getConfigValue('cliTools') || [];
  if (tools.length === 0) return '';
  const lines = tools.map((t: { name: string; description: string }) => `- \`${t.name}\`: ${t.description}`);
  return `\n\nThe following CLI tools may be available in the environment (verify before use):\n${lines.join('\n')}`;
}

export async function launchAgent(
  intentId: string,
  selectedText: string,
  anchor: AgentAnchor,
  workspaceRoot: string,
  intentFolder: string,
  _options?: { repo?: string; model?: string }
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
    const findRecord = (sid: string) => registry.findBySessionId(sid);

    const session = await client.createSession({
      workingDirectory: workingDir,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      tools: getCustomTools(),
      onPermissionRequest: broker.createPermissionHandler(findRecord),
      onUserInputRequest: broker.createUserInputHandler(findRecord),
      onElicitationRequest: broker.createElicitationHandler(findRecord),
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
      pendingPermissionKind: null,
      pendingApprovals: new Map(),
      summary: 'Starting...',
    };
    registry.set(agentId, record);

    // Persist to DB (both canvas_agents for backward compat + agent_sessions as central registry)
    persistence.createCanvasAgentRecord({
      id: agentId,
      intent_id: intentId,
      selected_text: selectedText,
      session_id: sessionId,
      pid: null,
      status: 'running',
      created_at: now,
      updated_at: now,
    });

    persistence.createAgentSessionRecord({
      id: agentId,
      session_id: sessionId,
      intent_id: intentId,
      prompt: selectedText,
      status: 'running',
      summary: 'Starting...',
      working_dir: workingDir,
      source: 'sdk',
      persona_handle: null,
      created_at: now,
      updated_at: now,
    });

    // Set up event listeners
    setupAgentEventListeners(session, record);

    // Log to per-intent activity log
    logIntentActivity(record, 'agent.launched', {
      sessionId,
      prompt: truncate(selectedText, 200),
      cwd: workingDir,
    });

    // Fire-and-forget: return agentId immediately so the renderer can subscribe
    // before events start flowing. Errors are handled by the session.error listener.
    session.send({
      prompt: selectedText,
      attachments: [{ type: 'file' as const, path: path.join(workingDir, 'canvas.md'), displayName: 'canvas.md' }],
    }).catch((err: any) => {
      record.status = 'failed';
      record.summary = `Error: ${err.message || 'Unknown'}`;
      persistence.updateStatus(record);
      notifier.notifyRenderer(`chat:event:${agentId}`, {
        type: 'session.error',
        message: err.message || 'Failed to process message',
      });
    });

    return { agentId, sessionId };
  } catch (err: any) {
    return { error: err.message || 'Failed to launch agent' };
  }
}

export async function launchQuickAgent(
  prompt: string,
  workspaceRoot: string,
  persona?: AgentPersona,
): Promise<{ agentId: string; sessionId: string } | { error: string }> {
  const client = getCopilotClient();
  if (!client) {
    return { error: 'Copilot SDK not initialized' };
  }

  const agentId = uuid();

  try {
    const cliToolsPrompt = buildCliToolsPrompt();
    const findRecord = (sid: string) => registry.findBySessionId(sid);

    const sandboxSetup = persona
      ? buildSandboxLaunchSetup({ agentId, workingDir: workspaceRoot, persona, registry, broker })
      : null;
    const isSandboxed = sandboxSetup?.isSandboxed === true;
    const sandboxConfigs = sandboxSetup?.sandboxConfigs ?? null;
    const mcpServers = sandboxSetup ? sandboxSetup.mcpServers : getAllMcpServers();
    const customTools = sandboxSetup ? sandboxSetup.customTools : getCustomTools();
    const sandboxState = sandboxSetup?.sandboxState;
    const hooks = sandboxSetup?.hooks;
    const enforcementMode = sandboxSetup?.enforcementMode ?? 'both';
    // In mxc-only mode, the path-aware permission handler is also suppressed
    // (MXC is the sole enforcer for shell; SDK reads/writes fall back to the
    // standard interactive handler).
    const useHostPathAwareHandler = isSandboxed && enforcementMode === 'both';

    // When a persona is supplied, prepend its instructions to the system message
    // and use its preferred model.  Persona handles are matched against the
    // 'personas' config; cloud routing happens in the IPC handler so this path
    // only handles local sessions (sandboxed or not).
    const personaPreamble = persona ? `${persona.instructions}\n\n` : '';
    const baseSystemContent = `${personaPreamble}${cliToolsPrompt}`.trim();
    const systemContent = isSandboxed
      ? `${baseSystemContent}${SANDBOX_WORKSPACE_SYSTEM_PROMPT}`
      : baseSystemContent;

    const session = await client.createSession({
      workingDirectory: workspaceRoot,
      ...(sandboxConfigs ? { configDir: sandboxConfigs.onDir } : {}),
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      tools: customTools,
      ...(persona?.model ? { model: persona.model } : {}),
      ...(hooks ? { hooks } : {}),
      ...(systemContent ? {
        systemMessage: {
          mode: 'append' as const,
          content: `\n${systemContent}`,
        },
      } : {}),
      onPermissionRequest: useHostPathAwareHandler
        ? broker.createPathAwareSandboxPermissionHandler(findRecord)
        : broker.createPermissionHandler(findRecord),
      onUserInputRequest: broker.createUserInputHandler(findRecord),
      onElicitationRequest: broker.createElicitationHandler(findRecord),
    });

    const sessionId = (session as any).sessionId || agentId;
    const now = new Date().toISOString();

    const summary = persona ? `Starting as @${persona.handle}...` : 'Starting...';

    const record: AgentRecord = {
      agentId,
      sessionId,
      session,
      intentId: '__workspace__',
      selectedText: prompt,
      anchor: { quote: '', prefix: '', suffix: '' },
      status: 'running',
      pendingApprovalId: null,
      pendingPermissionKind: null,
      pendingApprovals: new Map(),
      summary,
      ...(sandboxState ? { sandbox: sandboxState } : {}),
    };
    registry.set(agentId, record);

    persistence.createAgentSessionRecord({
      id: agentId,
      session_id: sessionId,
      intent_id: null,
      prompt,
      status: 'running',
      summary,
      working_dir: workspaceRoot,
      source: 'sdk',
      persona_handle: persona?.handle ?? null,
      created_at: now,
      updated_at: now,
    });

    setupAgentEventListeners(session, record);

    // Fire-and-forget: return agentId immediately so the renderer can subscribe
    // before events start flowing. Errors are handled by the session.error listener.
    session.send({ prompt }).catch((err: any) => {
      record.status = 'failed';
      record.summary = `Error: ${err.message || 'Unknown'}`;
      persistence.updateStatus(record);
      notifier.notifyRenderer(`chat:event:${agentId}`, {
        type: 'session.error',
        message: err.message || 'Failed to process message',
      });
    });

    return { agentId, sessionId };
  } catch (err: any) {
    return { error: err.message || 'Failed to launch agent' };
  }
}

/** Launch an SDK agent with the full canvas document as context, using the intent folder as cwd. */
export async function launchDocumentAgent(
  intentId: string,
  workspaceRoot: string,
  intentFolder: string,
): Promise<{ agentId: string; sessionId: string } | { error: string }> {
  const client = getCopilotClient();
  if (!client) {
    return { error: 'Copilot SDK not initialized' };
  }

  const agentId = uuid();
  const workingDir = path.join(workspaceRoot, intentFolder);

  // Read the full canvas document
  const fs = require('fs');
  const canvasPath = path.join(workingDir, 'canvas.md');
  let documentContent = '';
  try {
    if (fs.existsSync(canvasPath)) {
      documentContent = fs.readFileSync(canvasPath, 'utf-8');
    }
  } catch { /* proceed with empty content */ }

  if (!documentContent.trim()) {
    return { error: 'Canvas document is empty — add content before running' };
  }

  try {
    const mcpServers = getAllMcpServers();
    const cliToolsPrompt = buildCliToolsPrompt();
    const findRecord = (sid: string) => registry.findBySessionId(sid);

    const session = await client.createSession({
      workingDirectory: workingDir,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      tools: getCustomTools(),
      onPermissionRequest: broker.createPermissionHandler(findRecord),
      onUserInputRequest: broker.createUserInputHandler(findRecord),
      onElicitationRequest: broker.createElicitationHandler(findRecord),
      systemMessage: {
        mode: 'append',
        content: `\nThe user has pressed "Run" on their intent document. Execute all instructions in the document below. The full document is also available as canvas.md in your working directory.\n\n---\n${documentContent}\n---\n${cliToolsPrompt}`,
      },
    });

    const sessionId = (session as any).sessionId || agentId;
    const now = new Date().toISOString();

    const record: AgentRecord = {
      agentId,
      sessionId,
      session,
      intentId,
      selectedText: documentContent,
      anchor: { quote: '', prefix: '', suffix: '' },
      status: 'running',
      pendingApprovalId: null,
      pendingPermissionKind: null,
      pendingApprovals: new Map(),
      summary: 'Executing document...',
    };
    registry.set(agentId, record);

    persistence.createCanvasAgentRecord({
      id: agentId,
      intent_id: intentId,
      selected_text: truncate(documentContent, 500),
      session_id: sessionId,
      pid: null,
      status: 'running',
      created_at: now,
      updated_at: now,
    });

    persistence.createAgentSessionRecord({
      id: agentId,
      session_id: sessionId,
      intent_id: intentId,
      prompt: truncate(documentContent, 500),
      status: 'running',
      summary: 'Executing document...',
      working_dir: workingDir,
      source: 'sdk',
      persona_handle: null,
      created_at: now,
      updated_at: now,
    });

    setupAgentEventListeners(session, record);

    // Log to per-intent activity log
    logIntentActivity(record, 'document.executed', {
      sessionId,
      cwd: workingDir,
    });

    session.send({
      prompt: 'Execute the instructions in the document. Ask me if you need any clarification.',
      attachments: [{ type: 'file' as const, path: canvasPath, displayName: 'canvas.md' }],
    }).catch((err: any) => {
      record.status = 'failed';
      record.summary = `Error: ${err.message || 'Unknown'}`;
      persistence.updateStatus(record);
      notifier.notifyRenderer(`chat:event:${agentId}`, {
        type: 'session.error',
        message: err.message || 'Failed to process message',
      });
    });

    return { agentId, sessionId };
  } catch (err: any) {
    return { error: err.message || 'Failed to launch agent' };
  }
}

/** Send a follow-up message to an active agent session (multi-turn chat). */
export async function sendChatMessage(
  agentId: string,
  prompt: string,
  attachments?: Array<{ type: 'file'; path: string; displayName?: string }>,
): Promise<{ error?: string; restarted?: boolean }> {
  let record = registry.get(agentId);
  let restarted = false;
  if (!record) {
    // Agent not in memory — might be historical (app restarted).
    // Try to re-create a session for it.
    const result = await resumeAgentSession(agentId);
    if (!result) return { error: 'Agent session expired — open in CLI to resume' };
    restarted = result === 'restarted';
    record = registry.get(agentId)!;
  }
  if (record.status !== 'completed' && record.status !== 'running') {
    return { error: `Agent is ${record.status}, cannot send message` };
  }

  // Reactivate completed agents for multi-turn
  record.status = 'running';
  persistence.updateStatus(record);
  notifier.notifyRenderer('agent:status-changed', {
    agentId, status: 'running', summary: record.summary,
  });

  // Notify renderer if session was restarted
  if (restarted) {
    notifier.notifyRenderer(`chat:event:${agentId}`, {
      type: 'session.restarted',
      message: 'Previous session expired — started a fresh session with context from the original conversation.',
    });
  }

  try {
    const normalizedAttachments = attachments?.map(a => ({
      ...a,
      displayName: a.displayName ?? path.basename(a.path),
    }));
    await record.session.send({
      prompt,
      ...(normalizedAttachments ? { attachments: normalizedAttachments } : {}),
    });
    return { ...(restarted ? { restarted: true } : {}) };
  } catch (err: any) {
    return { error: err.message || 'Failed to send message' };
  }
}

/**
 * Disable the sandbox for the rest of an agent's session.  Resumes the SDK
 * session against the per-agent "off" configDir (whose `config.json` has
 * `sandbox.enabled: false`), swaps `record.session`, re-installs listeners,
 * and re-prompts the agent to retry its last operation.
 *
 * Idempotent: returns silently when the agent is unknown, already disabled,
 * or non-sandboxed.
 */
export async function disableSandboxForSession(agentId: string): Promise<void> {
  const record = registry.get(agentId);
  if (!record || !record.sandbox) {
    console.log(`[agent-service] disableSandboxForSession: no sandbox state for ${agentId}`);
    return;
  }
  if (record.sandbox.state === 'off') {
    console.log(`[agent-service] disableSandboxForSession: already off for ${agentId}`);
    return;
  }

  const client = getCopilotClient();
  if (!client) {
    console.error('[agent-service] disableSandboxForSession: no Copilot client');
    return;
  }

  // Drain any pending approval / interactive callbacks for this agent so the
  // resume below doesn't race against an old wait. clearPendingInteractions
  // already resolves them as deny / cancel / allow-once where appropriate.
  broker.clearPendingInteractions(record);

  try {
    const mcpServers = getAllMcpServers();
    const findRecord = (sid: string) => registry.findBySessionId(sid);
    const offDir = record.sandbox.configs.offDir;

    // Resume the same session id against the off-dir; the runtime will reload
    // its sandbox config (enabled=false) when it sees the new configDir.
    const newSession = await client.resumeSession(record.sessionId, {
      configDir: offDir,
      workingDirectory: (await import('../config')).getConfig().workspace ?? undefined,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      tools: getCustomTools(),
      onPermissionRequest: broker.createPermissionHandler(findRecord),
      onUserInputRequest: broker.createUserInputHandler(findRecord),
      onElicitationRequest: broker.createElicitationHandler(findRecord),
    });

    record.session = newSession;
    record.sandbox.state = 'off';
    record.status = 'running';
    persistence.updateStatus(record);

    setupAgentEventListeners(newSession, record);

    notifier.notifyRenderer(`chat:event:${agentId}`, {
      type: 'sandbox.disabled',
      reason: 'user-requested',
    });
    notifier.notifyRenderer('agent:status-changed', {
      agentId, status: 'running', summary: 'Sandbox disabled',
    });

    // Re-prompt the agent.  We use sendChatMessage so the existing pre-existing
    // record reactivation path runs.
    await newSession.send({
      prompt: 'Sandbox is now disabled. Please retry the operation that was just blocked.',
    });

    console.log(`[agent-service] Disabled sandbox for agent ${agentId}`);
  } catch (err: any) {
    console.error('[agent-service] disableSandboxForSession failed:', err);
    notifier.notifyRenderer(`chat:event:${agentId}`, {
      type: 'session.error',
      message: `Failed to disable sandbox: ${err?.message ?? 'unknown error'}`,
    });
  }
}

/** Attempt to resume a historical agent by restoring its SDK session.
 *  Returns 'resumed' if the original session was restored, 'restarted' if a
 *  new session was created because the original expired, or false on failure. */
async function resumeAgentSession(agentId: string): Promise<'resumed' | 'restarted' | false> {
  const persisted = persistence.getSession(agentId);
  if (!persisted) return false;

  const client = getCopilotClient();
  if (!client) return false;

  const config = getConfig();
  const workspaceRoot = config.workspace;
  if (!workspaceRoot) return false;

  const workingDir = persisted.working_dir || workspaceRoot;

  try {
    const mcpServers = getAllMcpServers();
    const findRecord = (sid: string) => registry.findBySessionId(sid);

    // Use resumeSession to restore full conversation history (not createSession
    // which would start a fresh session with no history).
    const session = await client.resumeSession(persisted.session_id, {
      workingDirectory: workingDir,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      tools: getCustomTools(),
      onPermissionRequest: broker.createPermissionHandler(findRecord),
      onUserInputRequest: broker.createUserInputHandler(findRecord),
      onElicitationRequest: broker.createElicitationHandler(findRecord),
    });

    const validStatuses = new Set(['running', 'waiting-approval', 'completed', 'failed']);
    const restoredStatus = validStatuses.has(persisted.status)
      ? persisted.status as import('./agent-registry').AgentStatus
      : 'completed';

    const record: AgentRecord = {
      agentId,
      sessionId: persisted.session_id,
      session,
      intentId: persisted.intent_id || '__workspace__',
      selectedText: persisted.prompt,
      anchor: { quote: '', prefix: '', suffix: '' },
      status: restoredStatus,
      pendingApprovalId: null,
      pendingPermissionKind: null,
      pendingApprovals: new Map(),
      summary: persisted.summary || 'Resumed',
    };
    registry.set(agentId, record);

    setupAgentEventListeners(session, record);
    return 'resumed';
  } catch (err) {
    console.warn('[agent-service] resumeSession failed, attempting fresh session fallback:', err);

    // Only attempt fallback for SDK sessions — CLI sessions must be resumed via CLI
    if (persisted.source !== 'sdk') {
      return false;
    }

    return restartExpiredSession(agentId, persisted, workingDir);
  }
}

/** Create a fresh SDK session to replace an expired one, preserving context. */
async function restartExpiredSession(
  agentId: string,
  persisted: import('../../shared/types').AgentSession,
  workingDir: string,
): Promise<'restarted' | false> {
  const client = getCopilotClient();
  if (!client) return false;

  try {
    const mcpServers = getAllMcpServers();
    const cliToolsPrompt = buildCliToolsPrompt();
    const findRecord = (sid: string) => registry.findBySessionId(sid);

    const isCanvasAgent = persisted.intent_id && persisted.intent_id !== '__workspace__';

    // Build system message with previous context
    let systemContent: string;
    if (isCanvasAgent) {
      // Reconstruct canvas-style system prompt with prior context
      systemContent =
        `\nThe user selected the following text from their canvas document and wants you to work on it:\n\n` +
        `---\n${persisted.prompt}\n---\n\n` +
        `The full canvas document is available as canvas.md in the working directory.${cliToolsPrompt}\n\n` +
        `Note: This is a continuation of a previous session that expired. ` +
        `The previous session summary was: "${truncate(persisted.summary || 'No summary', 500)}". ` +
        `Continue helping from where things left off.`;
    } else {
      systemContent =
        (cliToolsPrompt ? cliToolsPrompt + '\n\n' : '') +
        `Note: This is a continuation of a previous session that expired. ` +
        `The original request was: "${truncate(persisted.prompt, 500)}". ` +
        `The previous session summary was: "${truncate(persisted.summary || 'No summary', 500)}". ` +
        `Continue helping from where things left off.`;
    }

    const session = await client.createSession({
      workingDirectory: workingDir,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      tools: getCustomTools(),
      onPermissionRequest: broker.createPermissionHandler(findRecord),
      onUserInputRequest: broker.createUserInputHandler(findRecord),
      onElicitationRequest: broker.createElicitationHandler(findRecord),
      systemMessage: { mode: 'append', content: systemContent },
    });

    const newSessionId = (session as any).sessionId || agentId;

    const record: AgentRecord = {
      agentId,
      sessionId: newSessionId,
      session,
      intentId: persisted.intent_id || '__workspace__',
      selectedText: persisted.prompt,
      anchor: { quote: '', prefix: '', suffix: '' },
      status: 'completed',
      pendingApprovalId: null,
      pendingPermissionKind: null,
      pendingApprovals: new Map(),
      summary: persisted.summary || 'Session restarted',
      restarted: true,
    };
    registry.set(agentId, record);

    // Update DB with new session_id
    persistence.updateSessionId(agentId, newSessionId);

    setupAgentEventListeners(session, record);
    console.info(`[agent-service] Restarted expired session for agent ${agentId} (new session: ${newSessionId})`);
    return 'restarted';
  } catch (err) {
    console.error('[agent-service] Failed to restart expired session:', err);
    return false;
  }
}

/** Change the model for an active agent session. */
export async function setAgentModel(agentId: string, model: string): Promise<{ error?: string }> {
  let record = registry.get(agentId);
  if (!record) {
    const resumed = await resumeAgentSession(agentId);
    if (!resumed) return { error: 'Agent session not found' };
    record = registry.get(agentId)!;
  }

  try {
    await record.session.setModel(model);
    return {};
  } catch (err: any) {
    return { error: err.message || 'Failed to change model' };
  }
}

/** Resume an agent session and return its conversation history. */
export async function getAgentHistory(agentId: string): Promise<{ events: any[]; restarted?: boolean } | { error: string }> {
  // Resume if not already in memory
  let record = registry.get(agentId);
  if (!record) {
    const persisted = persistence.getSession(agentId);
    if (!persisted) return { error: 'Agent session not found in database' };

    const result = await resumeAgentSession(agentId);
    if (!result) {
      const sourceLabel = persisted.source === 'cli' ? 'CLI' : 'SDK';
      return { error: `Failed to resume ${sourceLabel} session — the session may have expired or been deleted` };
    }
    record = registry.get(agentId);
  }
  if (!record) return { error: 'Agent not found after resume' };

  const restarted = record.restarted === true;

  try {
    const events = await (record.session as any).getMessages();
    return { events: events || [], ...(restarted ? { restarted: true } : {}) };
  } catch (err: any) {
    console.error('[agent-service] Failed to get history:', err);
    return { error: err.message || 'Failed to load conversation history' };
  }
}

// ── Event Listener Setup ──────────────────────────────────────

/** Resolve workspace + intentFolder for activity logging. Returns null if unavailable. */
function resolveIntentActivityContext(record: AgentRecord): { workspaceRoot: string; intentFolder: string } | null {
  if (!record.intentId || record.intentId === '__workspace__') return null;
  const workspace = getConfigValue('workspace');
  if (!workspace) return null;
  try {
    const { getIntent } = require('../database');
    const intent = getIntent(record.intentId);
    if (!intent?.folder) return null;
    return { workspaceRoot: workspace, intentFolder: intent.folder };
  } catch { return null; }
}

/** Append to the per-intent activity log (non-fatal on failure). */
function logIntentActivity(record: AgentRecord, type: string, data: Record<string, any>): void {
  const ctx = resolveIntentActivityContext(record);
  if (!ctx) return;
  appendIntentActivity(ctx.workspaceRoot, ctx.intentFolder, type, { agentId: record.agentId, ...data });
}

export function setupAgentEventListeners(session: CopilotSession, record: AgentRecord): void {
  const agentId = record.agentId;
  const chatChannel = `chat:event:${agentId}`;

  // SDK events wrap payloads in event.data; fall back to top-level for compat
  session.on('assistant.message_delta', (event: any) => {
    const d = event.data ?? event;
    const delta = d.deltaContent ?? d.delta ?? '';
    notifier.notifyRenderer(chatChannel, { type: 'assistant.message_delta', delta });
  });

  session.on('assistant.message', (event: any) => {
    const d = event.data ?? event;
    const content = d.content || d.message || '';
    record.summary = truncate(content || 'Agent responded', 100);
    persistence.persistSummary(record);
    notifier.notifyRenderer('agent:status-changed', {
      agentId, status: record.status, summary: record.summary,
    });
    notifier.notifyRenderer(chatChannel, { type: 'assistant.message', content });
  });

  session.on('assistant.reasoning_delta', (event: any) => {
    const d = event.data ?? event;
    notifier.notifyRenderer(chatChannel, {
      type: 'assistant.reasoning_delta',
      reasoningId: d.reasoningId ?? '',
      delta: d.deltaContent ?? d.delta ?? '',
    });
  });

  session.on('assistant.reasoning', (event: any) => {
    const d = event.data ?? event;
    notifier.notifyRenderer(chatChannel, {
      type: 'assistant.reasoning',
      reasoningId: d.reasoningId ?? '',
      content: d.content ?? '',
    });
  });

  session.on('tool.execution_start', (event: any) => {
    const d = event.data ?? event;
    record.summary = `Using ${d.toolName || 'tool'}...`;
    notifier.notifyRenderer('agent:status-changed', {
      agentId, status: record.status, summary: record.summary,
    });
    notifier.notifyRenderer(chatChannel, {
      type: 'tool.start',
      toolCallId: d.toolCallId ?? '',
      toolName: d.toolName ?? '',
      args: d.arguments ?? d.toolArgs ?? {},
    });
    logIntentActivity(record, 'agent.tool_start', {
      toolName: d.toolName ?? '',
      toolCallId: d.toolCallId ?? '',
    });
  });

  session.on('tool.execution_progress', (event: any) => {
    const d = event.data ?? event;
    notifier.notifyRenderer(chatChannel, {
      type: 'tool.progress',
      toolCallId: d.toolCallId ?? '',
      message: d.progressMessage ?? '',
    });
  });

  session.on('tool.execution_complete', (event: any) => {
    const d = event.data ?? event;
    // SDK result is { content, detailedContent? } — flatten to string
    const rawResult = d.result;
    const result = typeof rawResult === 'string'
      ? rawResult
      : rawResult?.detailedContent ?? rawResult?.content ?? '';
    const success = d.success !== false;
    const errorMessage = d.error?.message ?? undefined;
    if (!success) {
      console.warn(`[agent-service] Tool ${d.toolCallId} completed with success=false (raw: ${d.success})${errorMessage ? `: ${errorMessage}` : ''}`);
    }
    notifier.notifyRenderer(chatChannel, {
      type: 'tool.complete',
      toolCallId: d.toolCallId ?? '',
      result,
      success,
      ...(errorMessage ? { error: errorMessage } : {}),
    });
    logIntentActivity(record, 'agent.tool_complete', {
      toolName: d.toolName ?? '',
      toolCallId: d.toolCallId ?? '',
      success,
      ...(errorMessage ? { error: errorMessage } : {}),
    });
  });

  session.on('session.idle', () => {
    if (record.status === 'running') {
      record.status = 'completed';
      record.summary = 'Completed';
      persistence.updateStatus(record);
      notifier.notifyRenderer('agent:completed', { agentId, summary: record.summary });
      notifier.notifyRenderer(chatChannel, { type: 'session.idle' });
      logIntentActivity(record, 'agent.completed', { summary: record.summary });

      // Clean up sub-agent state
      subagentTracker.clearParent(agentId);

      // Clean up per-agent sandbox config dirs (if any)
      if (record.sandbox) {
        const { cleanupSandboxConfigs } = require('../ai');
        cleanupSandboxConfigs(agentId);
      }

      // Handle comment agent auto-reply + presence cleanup
      if (record.commentContext) {
        // Dynamically import to avoid circular dependency
        const { handleCommentAgentCompletion } = require('./comment-workflow');
        handleCommentAgentCompletion(record);
      }
    }
  });

  session.on('session.error', (event: any) => {
    const d = event.data ?? event;
    record.status = 'failed';
    record.summary = `Error: ${d.message || 'Unknown error'}`;
    persistence.updateStatus(record);
    notifier.notifyRenderer('agent:status-changed', {
      agentId, status: 'failed', summary: record.summary,
    });
    notifier.notifyRenderer(chatChannel, {
      type: 'session.error',
      message: d.message || 'Unknown error',
    });
    logIntentActivity(record, 'agent.failed', { error: d.message || 'Unknown error' });

    // Clean up presence on failure too
    if (record.commentContext) {
      notifier.notifyRenderer('agent:presence-ended', { agentId, intentId: record.intentId });
    }

    // Clean up per-agent sandbox config dirs on failure
    if (record.sandbox) {
      const { cleanupSandboxConfigs } = require('../ai');
      cleanupSandboxConfigs(agentId);
    }
  });

  // Sub-agent tracking via catch-all listener
  installSubagentSubscription(session, record);
}

/**
 * Subscribe to all SDK events and route sub-agent events to the SubagentTracker.
 * The SDK supports session.on(callback) as a catch-all — it receives every event
 * including ones tagged with event.agentId for sub-agents.
 */
function installSubagentSubscription(session: CopilotSession, record: AgentRecord): void {
  const parentAgentId = record.agentId;
  const chatChannel = `chat:event:${parentAgentId}`;

  (session as any).on((event: any) => {
    const d = event.data ?? event;
    const type = event.type ?? d.type;

    // --- Sub-agent lifecycle events ---
    if (type === 'subagent.started') {
      subagentTracker.trackStarted(parentAgentId, {
        agentId: d.agentId,
        toolCallId: d.toolCallId ?? '',
        agentName: d.name ?? d.agentName ?? '',
        agentDisplayName: d.displayName ?? d.agentDisplayName ?? d.name ?? '',
        agentDescription: d.description ?? d.agentDescription ?? '',
      });
      notifier.notifyRenderer(chatChannel, {
        type: 'subagent.started',
        toolCallId: d.toolCallId ?? '',
        name: d.name ?? d.agentName ?? '',
        displayName: d.displayName ?? d.agentDisplayName ?? d.name ?? '',
        description: d.description ?? d.agentDescription ?? '',
        agentId: d.agentId,
      });
      logIntentActivity(record, 'subagent.started', {
        subagentId: d.agentId,
        name: d.name ?? d.agentName ?? '',
        description: d.description ?? d.agentDescription ?? '',
      });
      return;
    }

    if (type === 'subagent.completed') {
      subagentTracker.trackCompleted(parentAgentId, {
        agentId: d.agentId,
        toolCallId: d.toolCallId ?? '',
        agentName: d.name ?? d.agentName,
        agentDisplayName: d.displayName ?? d.agentDisplayName,
        durationMs: d.durationMs,
        model: d.model,
        totalTokens: d.totalTokens,
        totalToolCalls: d.totalToolCalls,
      });
      notifier.notifyRenderer(chatChannel, {
        type: 'subagent.completed',
        toolCallId: d.toolCallId ?? '',
        name: d.name ?? d.agentName ?? '',
        agentId: d.agentId,
        durationMs: d.durationMs,
        model: d.model,
        totalTokens: d.totalTokens,
        totalToolCalls: d.totalToolCalls,
      });
      logIntentActivity(record, 'subagent.completed', {
        subagentId: d.agentId,
        name: d.name ?? d.agentName ?? '',
        durationMs: d.durationMs,
        model: d.model,
        totalTokens: d.totalTokens,
      });
      return;
    }

    if (type === 'subagent.failed') {
      subagentTracker.trackFailed(parentAgentId, {
        agentId: d.agentId,
        toolCallId: d.toolCallId ?? '',
        agentName: d.name ?? d.agentName,
        error: d.error ?? 'Unknown error',
        durationMs: d.durationMs,
        model: d.model,
        totalTokens: d.totalTokens,
        totalToolCalls: d.totalToolCalls,
      });
      notifier.notifyRenderer(chatChannel, {
        type: 'subagent.failed',
        toolCallId: d.toolCallId ?? '',
        name: d.name ?? d.agentName ?? '',
        error: d.error ?? 'Unknown error',
        agentId: d.agentId,
      });
      logIntentActivity(record, 'subagent.failed', {
        subagentId: d.agentId,
        name: d.name ?? d.agentName ?? '',
        error: d.error ?? 'Unknown error',
      });
      return;
    }

    // --- agentId-tagged events route to the tracker ---
    const subAgentId = d.agentId || event.agentId;
    if (!subAgentId) return; // parent-level events already handled above

    if (type === 'assistant.message_delta') {
      const delta = d.deltaContent ?? d.delta ?? '';
      subagentTracker.trackStreamingDelta(parentAgentId, subAgentId, delta);
    } else if (type === 'assistant.message') {
      subagentTracker.trackTurnStart(parentAgentId, subAgentId);
    } else if (type === 'assistant.intent') {
      const intent = d.intent ?? d.content ?? '';
      subagentTracker.trackIntent(parentAgentId, subAgentId, intent);
    } else if (type === 'tool.execution_start') {
      subagentTracker.trackToolStart(parentAgentId, subAgentId, {
        toolCallId: d.toolCallId ?? '',
        toolName: d.toolName ?? '',
        args: d.arguments ?? d.toolArgs ?? {},
      });
    } else if (type === 'tool.execution_complete') {
      const rawResult = d.result;
      const result = typeof rawResult === 'string'
        ? rawResult
        : rawResult?.detailedContent ?? rawResult?.content ?? '';
      subagentTracker.trackToolComplete(parentAgentId, subAgentId, {
        toolCallId: d.toolCallId ?? '',
        success: d.success !== false,
        result,
        error: d.error,
      });
    } else if (type === 'assistant.usage') {
      subagentTracker.trackUsage(
        parentAgentId,
        subAgentId,
        d.inputTokens ?? d.input_tokens ?? 0,
        d.outputTokens ?? d.output_tokens ?? 0,
      );
      if (d.model) {
        subagentTracker.trackModel(parentAgentId, subAgentId, d.model);
      }
    } else if (type === 'session.idle') {
      subagentTracker.trackIdle(parentAgentId, subAgentId);
    }
  });
}
