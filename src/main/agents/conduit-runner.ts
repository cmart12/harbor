/**
 * Conduit agent runner — launches and manages agents running inside Conduit sessions.
 *
 * Follows the same DI + event-forwarding pattern as sdk-runner.ts, but uses
 * the lightweight Conduit client (conduit-client.ts) instead of @github/copilot-sdk.
 */
import { v4 as uuid } from 'uuid';
import * as path from 'path';
import { getConfigValue, setConfigValue, type AgentPersona } from '../config';
import {
  getConduitHostClient,
  connectConduitSession,
  type ConduitAgentSession,
  type ConduitClientInfo,
} from '../conduit-client';
import { AgentRegistry, truncate } from './agent-registry';
import type { AgentRecord } from './agent-registry';
import { AgentNotifier } from './agent-notifier';
import { AgentPersistence } from './agent-persistence';
import { InteractionBroker } from './interaction-broker';
import { appendSpaceActivity } from '../space-eventlog';

/** Shared dependencies injected from agent-service at init time. */
let registry: AgentRegistry;
let notifier: AgentNotifier;
let persistence: AgentPersistence;
let broker: InteractionBroker;

export function initConduitRunner(deps: {
  registry: AgentRegistry;
  notifier: AgentNotifier;
  persistence: AgentPersistence;
  broker: InteractionBroker;
}): void {
  registry = deps.registry;
  notifier = deps.notifier;
  persistence = deps.persistence;
  broker = deps.broker;
}

// ── Agent lifecycle ────────────────────────────────────────────────

/**
 * Launch an agent via Conduit. Creates a session on the Conduit host,
 * connects over WebSocket, and submits the initial prompt.
 */
export async function launchConduitAgent(
  spaceId: string | null,
  prompt: string,
  workspaceRoot: string,
  spaceFolder: string,
  persona?: AgentPersona,
): Promise<{ agentId: string; sessionId: string } | { error: string }> {
  const hostClient = getConduitHostClient();
  if (!hostClient) {
    return { error: 'Conduit host URL not configured (set conduitHostUrl in settings)' };
  }

  const reachable = await hostClient.isReachable();
  if (!reachable) {
    return { error: `Cannot reach Conduit host at ${hostClient.baseUrl} — is it running?` };
  }

  const agentId = uuid();
  const workingDir = path.join(workspaceRoot, spaceFolder);

  try {
    // Require a profile — sessions need one for inference
    const profile = getConfigValue('conduitProfile') || undefined;
    if (!profile) {
      return { error: 'No Conduit profile selected. Open Settings → Conduit and select a profile.' };
    }
    const connectResult = await hostClient.createAndConnect({
      workspacePath: workingDir,
      orphanPolicy: 'timeout',
      orphanTimeoutSeconds: 300,
      profile,
      clientName: persona?.handle ?? 'whim',
    });

    const conduitSessionId = connectResult.connection.sessionId;
    const clientDisplayName = persona?.handle ?? 'whim';
    const conduitSession = await connectConduitSession(connectResult.connection, clientDisplayName);

    const now = new Date().toISOString();

    // We create a stub CopilotSession-compatible object so the AgentRecord
    // type is satisfied. The real interaction goes through conduitSession.
    const stubSession = createStubCopilotSession(conduitSessionId);

    const record: AgentRecord = {
      agentId,
      sessionId: conduitSessionId,
      session: stubSession,
      spaceId: spaceId || '__workspace__',
      selectedText: prompt,
      anchor: { quote: '', prefix: '', suffix: '' },
      status: 'running',
      pendingApprovalId: null,
      pendingPermissionKind: null,
      pendingApprovals: new Map(),
      summary: 'Starting (Conduit)...',
      conduitSession,
    };
    registry.set(agentId, record);

    // Persist to DB
    persistence.createAgentSessionRecord({
      id: agentId,
      session_id: conduitSessionId,
      space_id: spaceId,
      prompt: truncate(prompt, 500),
      status: 'running',
      summary: 'Starting (Conduit)...',
      working_dir: workingDir,
      source: 'conduit',
      persona_handle: persona?.handle ?? null,
      quoted_text: null,
      created_at: now,
      updated_at: now,
    });

    // Set up event listeners (maps Conduit notifications → Intent chat events)
    setupConduitEventListeners(conduitSession, record);

    // Log activity
    logConduitActivity(record, 'agent.launched', {
      sessionId: conduitSessionId,
      prompt: truncate(prompt, 200),
      cwd: workingDir,
      source: 'conduit',
    });

    // Submit initial prompt — prepend persona instructions if configured
    const effectivePrompt = persona?.instructions
      ? `${persona.instructions}\n\n${prompt}`
      : prompt;
    conduitSession.agentSubmit({ prompt: effectivePrompt }).catch((err: any) => {
      record.status = 'failed';
      record.summary = `Error: ${err.message || 'Unknown'}`;
      persistence.updateStatus(record);
      notifier.notifyRenderer(`chat:event:${agentId}`, {
        type: 'session.error',
        message: err.message || 'Failed to submit to Conduit agent',
      });
    });

    return { agentId, sessionId: conduitSessionId };
  } catch (err: any) {
    return { error: err.message || 'Failed to launch Conduit agent' };
  }
}

/**
 * Connect to an existing running Conduit session and register it as an agent.
 */
export async function joinConduitSession(
  conduitSessionId: string,
  spaceId: string,
): Promise<{ agentId: string; sessionId: string } | { error: string }> {
  const hostClient = getConduitHostClient();
  if (!hostClient) {
    return { error: 'Conduit host URL not configured' };
  }

  try {
    const joinResult = await hostClient.joinSession(conduitSessionId, 'whim');
    const conduitSession = await connectConduitSession(joinResult, 'whim');

    const agentId = uuid();
    const now = new Date().toISOString();
    const stubSession = createStubCopilotSession(conduitSessionId);

    const record: AgentRecord = {
      agentId,
      sessionId: conduitSessionId,
      session: stubSession,
      spaceId,
      selectedText: '',
      anchor: { quote: '', prefix: '', suffix: '' },
      status: 'running',
      pendingApprovalId: null,
      pendingPermissionKind: null,
      pendingApprovals: new Map(),
      summary: 'Connected to Conduit session',
      conduitSession,
    };
    registry.set(agentId, record);

    persistence.createAgentSessionRecord({
      id: agentId,
      session_id: conduitSessionId,
      space_id: spaceId,
      prompt: '(joined existing session)',
      status: 'running',
      summary: 'Connected to Conduit session',
      working_dir: null,
      source: 'conduit',
      persona_handle: null,
      quoted_text: null,
      created_at: now,
      updated_at: now,
    });

    setupConduitEventListeners(conduitSession, record);

    return { agentId, sessionId: conduitSessionId };
  } catch (err: any) {
    return { error: err.message || 'Failed to join Conduit session' };
  }
}

/** Send a follow-up message to an active Conduit agent. */
export async function sendConduitChatMessage(
  agentId: string,
  prompt: string,
): Promise<{ error?: string }> {
  const record = registry.get(agentId);
  if (!record) return { error: 'Agent not found' };
  if (!record.conduitSession) return { error: 'Not a Conduit agent' };

  if (record.status !== 'running' && record.status !== 'completed') {
    return { error: `Agent is ${record.status}, cannot send message` };
  }

  // Reactivate for multi-turn
  record.status = 'running';
  persistence.updateStatus(record);
  notifier.notifyRenderer('agent:status-changed', {
    agentId,
    status: 'running',
    summary: record.summary,
  });

  try {
    await record.conduitSession.agentSubmit({ prompt });
    return {};
  } catch (err: any) {
    return { error: err.message || 'Failed to send message' };
  }
}

/** Abort a running Conduit agent. */
export async function abortConduitAgent(agentId: string): Promise<void> {
  const record = registry.get(agentId);
  if (!record?.conduitSession) return;

  try {
    await record.conduitSession.agentAbort();
  } catch {
    // ignore — might already be idle
  }

  record.status = 'failed';
  record.summary = 'Aborted by user';
  persistence.updateStatus(record);
  notifier.notifyRenderer('agent:status-changed', {
    agentId,
    status: 'failed',
    summary: 'Aborted',
  });
}

/** Disconnect from a Conduit session and clean up. */
export async function disconnectConduitAgent(agentId: string): Promise<void> {
  const record = registry.get(agentId);
  if (!record?.conduitSession) return;

  record._intentionalDisconnect = true;
  await record.conduitSession.close();
  record.conduitSession = undefined;
}

/** Get conversation history from a Conduit agent session. */
export async function getConduitAgentHistory(agentId: string): Promise<any[] | null> {
  const record = registry.get(agentId);
  if (!record?.conduitSession) return null;

  try {
    const result = await record.conduitSession.agentHistory();
    return result.messages ?? [];
  } catch {
    return null;
  }
}

/** List running sessions on the configured Conduit host. */
export async function listConduitSessions(): Promise<
  Array<{ id: string; status: string; summary?: string; createdAt: string; clientCount?: number }> | { error: string }
> {
  const hostClient = getConduitHostClient();
  if (!hostClient) return { error: 'Conduit host URL not configured' };

  try {
    const sessions = await hostClient.listSessions('running');
    return sessions.map(s => ({
      id: s.id,
      status: s.status,
      summary: s.summary,
      createdAt: s.createdAt,
      clientCount: s.clientCount,
    }));
  } catch (err: any) {
    return { error: err.message || 'Failed to list sessions' };
  }
}

/** Check connectivity to the configured Conduit host. */
export async function getConduitHostStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  url: string | null;
  hasProfiles: boolean;
  profileId: string | null;
  profileName: string | null;
}> {
  const url = getConfigValue('conduitHostUrl');
  if (!url) {
    return { configured: false, connected: false, url: null, hasProfiles: false, profileId: null, profileName: null };
  }

  const hostClient = getConduitHostClient();
  const connected = hostClient ? await hostClient.isReachable() : false;

  let hasProfiles = false;
  let profileId: string | null = getConfigValue('conduitProfile') || null;
  let profileName: string | null = null;

  if (connected && hostClient) {
    try {
      const profiles = await hostClient.listProfiles();
      hasProfiles = profiles.filter(p => p.enabled).length > 0;

      // If we have a stored profile, resolve its name
      if (profileId) {
        const match = profiles.find(p => p.id === profileId);
        profileName = match?.name ?? null;
        // If stored profile no longer exists, clear it
        if (!match) {
          profileId = null;
          setConfigValue('conduitProfile', null);
        }
      }

      // If no profile selected but there's a default, use it
      if (!profileId && hasProfiles) {
        try {
          const def = await hostClient.getDefaultProfile();
          if (def.defaultProfileId && def.profile?.enabled) {
            profileId = def.defaultProfileId;
            profileName = def.profile.name;
            setConfigValue('conduitProfile', profileId);
          }
        } catch { /* ignore */ }
      }

      // Last resort: pick the first enabled profile
      if (!profileId && hasProfiles) {
        const first = profiles.find(p => p.enabled);
        if (first) {
          profileId = first.id;
          profileName = first.name;
          setConfigValue('conduitProfile', profileId);
        }
      }
    } catch (err: any) {
      console.warn(`[conduit] Failed to fetch profiles: ${err.message}`);
    }
  }

  return { configured: true, connected, url, hasProfiles, profileId, profileName };
}

/** List available profiles from the Conduit host. */
export async function listConduitProfiles(): Promise<
  Array<{ id: string; name: string; description?: string; enabled: boolean; agentAdapter?: string }> | { error: string }
> {
  const hostClient = getConduitHostClient();
  if (!hostClient) return { error: 'Conduit host URL not configured' };

  try {
    const profiles = await hostClient.listProfiles();
    return profiles.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      enabled: p.enabled,
      agentAdapter: p.agentAdapter,
    }));
  } catch (err: any) {
    return { error: err.message || 'Failed to list profiles' };
  }
}

// ── Event mapping ──────────────────────────────────────────────────

/**
 * Map Conduit agent notifications to Intent's chat event format.
 *
 * Conduit emits JSON-RPC notifications with methods like:
 *   agent.task_completed, agent.permission_request, agent.assistant_message, etc.
 *
 * Intent expects events on `chat:event:{agentId}` with types like:
 *   session.idle, assistant.message, tool.start, tool.complete, etc.
 */
function setupConduitEventListeners(
  conduitSession: ConduitAgentSession,
  record: AgentRecord,
): void {
  const agentId = record.agentId;
  const chatChannel = `chat:event:${agentId}`;

  conduitSession.on('notification', (method: string, params: any) => {
    switch (method) {
      // ── Assistant messages (dot and underscore variants) ──
      case 'agent.assistant.message_delta': {
        const delta = params?.deltaContent ?? params?.delta ?? '';
        if (delta) {
          notifier.notifyRenderer(chatChannel, {
            type: 'assistant.message_delta',
            delta,
          });
        }
        break;
      }

      case 'agent.assistant.message':
      case 'agent.assistant_message': {
        const content = params?.content || params?.message || '';
        record.summary = truncate(content || 'Agent responded', 100);
        persistence.persistSummary(record);
        notifier.notifyRenderer('agent:status-changed', {
          agentId, status: record.status, summary: record.summary,
        });
        notifier.notifyRenderer(chatChannel, {
          type: 'assistant.message',
          content,
        });
        break;
      }

      case 'agent.assistant.turn_end':
      case 'agent.assistant_turn_end': {
        break;
      }

      // ── Tool execution ─────────────────────────────────
      case 'agent.tool.execution_start':
      case 'agent.tool_execution_start': {
        const toolName = params?.toolName || 'tool';
        record.summary = `Using ${toolName}...`;
        notifier.notifyRenderer('agent:status-changed', {
          agentId, status: record.status, summary: record.summary,
        });
        notifier.notifyRenderer(chatChannel, {
          type: 'tool.start',
          toolCallId: params?.toolCallId ?? '',
          toolName,
          args: params?.arguments ?? params?.toolArgs ?? {},
        });
        logConduitActivity(record, 'agent.tool_start', {
          toolName,
          toolCallId: params?.toolCallId ?? '',
        });
        break;
      }

      case 'agent.tool.execution_complete':
      case 'agent.tool_execution_end': {
        const rawResult = params?.result;
        const result = typeof rawResult === 'string'
          ? rawResult
          : rawResult?.detailedContent ?? rawResult?.content ?? '';
        const success = params?.success !== false;
        const errorMessage = params?.error?.message ?? undefined;
        notifier.notifyRenderer(chatChannel, {
          type: 'tool.complete',
          toolCallId: params?.toolCallId ?? '',
          result,
          success,
          ...(errorMessage ? { error: errorMessage } : {}),
        });
        logConduitActivity(record, 'agent.tool_complete', {
          toolName: params?.toolName ?? '',
          toolCallId: params?.toolCallId ?? '',
          success,
        });
        break;
      }

      // ── Lifecycle ──────────────────────────────────────
      case 'agent.session.idle':
      case 'agent.session_idle': {
        if (record.status === 'running') {
          record.status = 'completed';
          record.summary = 'Completed';
          persistence.updateStatus(record);
          notifier.notifyRenderer('agent:completed', { agentId, summary: record.summary });
          notifier.notifyRenderer(chatChannel, { type: 'session.idle' });
          logConduitActivity(record, 'agent.completed', { summary: record.summary });
        }
        break;
      }

      case 'agent.task_started': {
        record.summary = params?.message || 'Working...';
        notifier.notifyRenderer('agent:status-changed', {
          agentId, status: record.status, summary: record.summary,
        });
        break;
      }

      case 'agent.task_completed': {
        // task_completed is a lifecycle signal, not a message event.
        // The content was already streamed via agent.assistant_message.
        // Only update summary/status to avoid duplicate rendering.
        const content = params?.content || '';
        record.summary = truncate(content || 'Task completed', 100);
        persistence.persistSummary(record);
        notifier.notifyRenderer('agent:status-changed', {
          agentId, status: record.status, summary: record.summary,
        });
        break;
      }

      case 'agent.error': {
        record.status = 'failed';
        record.summary = `Error: ${params?.message || 'Unknown error'}`;
        persistence.updateStatus(record);
        notifier.notifyRenderer('agent:status-changed', {
          agentId, status: 'failed', summary: record.summary,
        });
        notifier.notifyRenderer(chatChannel, {
          type: 'session.error',
          message: params?.message || 'Unknown error',
        });
        logConduitActivity(record, 'agent.failed', { error: params?.message || 'Unknown' });
        break;
      }

      // ── Permission / user input ────────────────────────
      case 'agent.permission.request':
      case 'agent.permission_request': {
        const requestId = params?.requestId;
        const kind = params?.kind || 'unknown';
        if (requestId) {
          record.status = 'waiting-approval';
          record.pendingApprovalId = requestId;
          record.pendingPermissionKind = kind;
          record.pendingApprovals.set(requestId, {
            permissionKind: kind,
            intention: params?.toolName,
            path: params?.path,
          });
          persistence.updateStatus(record);

          notifier.notifyRenderer('agent:approval-needed', {
            agentId,
            requestId,
            permissionKind: kind,
            toolName: params?.toolName,
            command: params?.command,
            path: params?.path,
            url: params?.url,
          });
          notifier.notifyRenderer('agent:status-changed', {
            agentId, status: 'waiting-approval', summary: `Needs approval: ${kind}`,
          });
          // Also emit on the chat channel so the chat UI can display it
          notifier.notifyRenderer(chatChannel, {
            type: 'approval.needed',
            requestId,
            permissionKind: kind,
            toolName: params?.toolName,
            command: params?.command,
            path: params?.path,
          });

          // Auto-approve if yolo mode is enabled
          if (record.yoloMode) {
            approveConduitPermission(agentId, requestId, true);
          }
        }
        break;
      }

      case 'agent.user_input.request':
      case 'agent.user_input_request': {
        const requestId = params?.requestId;
        if (requestId) {
          notifier.notifyRenderer('agent:user-input-needed', {
            agentId,
            requestId,
            prompt: params?.prompt || 'Agent needs your input',
          });
          // Also emit on the chat channel so the chat UI can display it
          notifier.notifyRenderer(chatChannel, {
            type: 'user_input.requested',
            requestId,
            prompt: params?.prompt || 'Agent needs your input',
          });
        }
        break;
      }

      // ── Usage / metrics ────────────────────────────────
      case 'agent.assistant.usage':
      case 'agent.assistant_usage':
      case 'agent.session.usage_info':
      case 'agent.session_usage_info': {
        // Forward token usage if renderer wants it
        notifier.notifyRenderer(chatChannel, {
          type: 'assistant.usage',
          inputTokens: params?.inputTokens ?? params?.input_tokens ?? 0,
          outputTokens: params?.outputTokens ?? params?.output_tokens ?? 0,
        });
        break;
      }

      // ── Initialized ────────────────────────────────────
      case 'agent.initialized': {
        record.summary = 'Agent ready';
        notifier.notifyRenderer('agent:status-changed', {
          agentId, status: record.status, summary: record.summary,
        });
        break;
      }

      // ── Model change ───────────────────────────────────
      case 'agent.session.model_change':
      case 'agent.model_changed': {
        const model = params?.model || params?.modelId;
        if (model) {
          notifier.notifyRenderer(chatChannel, {
            type: 'model.changed',
            model,
          });
        }
        break;
      }

      // ── Client roster ──────────────────────────────────
      case 'client.roster': {
        const clients = params?.clients ?? [];
        record.connectedClients = clients;
        notifier.notifyRenderer(chatChannel, {
          type: 'client.roster',
          clients,
        });
        break;
      }

      case 'client.joined': {
        const name = params?.clientName || 'unnamed';
        notifier.notifyRenderer(chatChannel, {
          type: 'client.joined',
          clientId: params?.clientId,
          clientName: name,
          connectedAt: params?.connectedAt,
        });
        break;
      }

      case 'client.left':
      case 'client.disconnected': {
        const name = params?.clientName || 'unnamed';
        notifier.notifyRenderer(chatChannel, {
          type: 'client.left',
          clientId: params?.clientId,
          clientName: name,
        });
        break;
      }

      default: {
        // Suppress known-harmless lifecycle / internal events.
        // Mirrors the IGNORED_EVENT_TYPES from the conduit agent-tui.
        const ignored = [
          // User echo & task lifecycle
          'agent.user.message', 'agent.task_started', 'agent.task_completed',
          // Streaming variants handled elsewhere
          'agent.assistant.turn_start', 'agent.assistant.turn_end',
          'agent.assistant.streaming_delta',
          // Session lifecycle & config
          'agent.session.tools_updated', 'agent.session.skills_loaded',
          'agent.session.custom_agents_updated', 'agent.session.mcp_servers_loaded',
          'agent.session.mcp_server_status_changed', 'agent.session.extensions_loaded',
          'agent.session.background_tasks_changed', 'agent.session.shutdown',
          'agent.session.title_changed', 'agent.session.context_changed',
          'agent.session.mode_changed', 'agent.session.plan_changed',
          'agent.session.workspace_file_changed', 'agent.session.start',
          'agent.session.resume',
          // System & provider housekeeping
          'agent.system.message', 'agent.pending_messages.modified',
          'agent.profile_changed', 'agent.provider_changed',
          'agent.mcps_changed', 'agent.skills_changed',
          'agent.agents_changed', 'agent.tools_changed',
          'agent.restored',
          // Permission completion (request is handled above)
          'agent.permission.completed', 'agent.permission_completed',
          // User input / elicitation completion
          'agent.user_input.completed', 'agent.user_input_completed',
          'agent.elicitation.requested', 'agent.elicitation.completed',
          'agent.exit_plan_mode.requested', 'agent.exit_plan_mode.completed',
          // Skill / hook lifecycle
          'agent.skill.invoked', 'agent.hook.start', 'agent.hook.end',
          // Tool progress (handled via tool.start/complete)
          'agent.tool.execution_progress', 'agent.tool.start', 'agent.tool.end',
        ];
        if (!ignored.includes(method)) {
          console.log(`[conduit-runner] Unhandled notification: ${method}`);
        }
      }
    }
  });

  // Handle WebSocket disconnection
  conduitSession.on('disconnected', () => {
    // Intentional disconnects (user-initiated) should not mark as failed
    if (record._intentionalDisconnect) return;

    if (record.status === 'running' || record.status === 'waiting-approval') {
      record.status = 'failed';
      record.summary = 'Conduit session disconnected';
      persistence.updateStatus(record);
      notifier.notifyRenderer('agent:status-changed', {
        agentId, status: 'failed', summary: record.summary,
      });
      notifier.notifyRenderer(chatChannel, {
        type: 'session.error',
        message: 'Connection to Conduit session lost',
      });
    }
  });
}

// ── Permission handling ────────────────────────────────────────────

/**
 * Approve or deny a pending Conduit permission request.
 */
export function approveConduitPermission(
  agentId: string,
  requestId: string,
  approved: boolean,
): void {
  const record = registry.get(agentId);
  if (!record?.conduitSession) return;

  record.conduitSession.agentPermissionResponse({
    requestId,
    result: approved ? 'allow' : 'deny',
  }).then(() => {
    // Clear local state only after successful ACK
    record.pendingApprovals.delete(requestId);
    record.pendingApprovalId = null;
    record.pendingPermissionKind = null;

    if (record.pendingApprovals.size === 0 && record.status === 'waiting-approval') {
      record.status = 'running';
      persistence.updateStatus(record);
      notifier.notifyRenderer('agent:status-changed', {
        agentId, status: 'running', summary: record.summary,
      });
    }

    // Emit resolution on chat channel
    notifier.notifyRenderer(`chat:event:${agentId}`, {
      type: 'approval.resolved',
      requestId,
      approved,
    });
  }).catch((err: any) => {
    console.error(`[conduit-runner] Failed to send permission response: ${err.message}`);
  });
}

/**
 * Respond to a Conduit user input request.
 */
export function respondToConduitUserInput(
  agentId: string,
  requestId: string,
  answer: string,
): void {
  const record = registry.get(agentId);
  if (!record?.conduitSession) return;

  record.conduitSession.agentUserInputResponse({
    requestId,
    answer,
  }).catch((err: any) => {
    console.error(`[conduit-runner] Failed to send user input response: ${err.message}`);
  });
}

// ── Helpers ────────────────────────────────────────────────────────

function logConduitActivity(record: AgentRecord, event: string, data: Record<string, unknown>): void {
  if (!record.spaceId || record.spaceId === '__workspace__') return;
  const workspace = getConfigValue('workspace');
  if (!workspace) return;
  try {
    const { getSpace } = require('../database');
    const space = getSpace(record.spaceId);
    if (!space?.folder) return;
    appendSpaceActivity(workspace, space.folder, event, {
      agentId: record.agentId,
      ...data,
    });
  } catch { /* non-fatal */ }
}

/**
 * Create a minimal stub that satisfies the CopilotSession type in AgentRecord.
 * For conduit agents, the real interaction goes through conduitSession.
 */
function createStubCopilotSession(sessionId: string): any {
  return {
    sessionId,
    send: () => Promise.reject(new Error('Use conduitSession for Conduit agents')),
    abort: () => Promise.reject(new Error('Use conduitSession for Conduit agents')),
    on: () => {},
    off: () => {},
  };
}
