import { CopilotSession } from '@github/copilot-sdk';
import { v4 as uuid } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { getCopilotClient, getEphemeralCopilotClient } from '../ai';
import { AgentAnchor } from '../../shared/types';
import { getConfig, getConfigValue, type AgentPersona } from '../config';
import { getAllMcpServers } from '../mcp';
import { AgentRegistry, truncate } from './agent-registry';
import { InMemoryFsProvider } from './in-memory-fs-provider';
import type { AgentRecord } from './agent-registry';
import { AgentNotifier } from './agent-notifier';
import { AgentPersistence } from './agent-persistence';
import { InteractionBroker } from './interaction-broker';
import type { SubagentTracker } from '../subagent-service';
import { getCustomTools, type CustomToolsContext } from '../tools';
import { appendSpaceActivity } from '../space-eventlog';
import { buildSandboxLaunchSetup } from './sandbox-launch';
import { SANDBOX_WORKSPACE_SYSTEM_PROMPT } from './sandbox-policies';
import { listSpaces, updateCanvasContent, listSkills } from '../database';
import { getWorkspaceRepo } from '../cloud-agent';
import { parseFrontmatter } from '../frontmatter';

/**
 * Resolve cloud session options from the workspace. Attempts to detect the
 * GitHub repository so the cloud sandbox is provisioned with repo context.
 */
async function resolveCloudSessionOptions(workspaceRoot: string): Promise<{ repository?: { owner: string; name: string } }> {
  try {
    const repoInfo = await getWorkspaceRepo(workspaceRoot);
    if (repoInfo) {
      return { repository: { owner: repoInfo.owner, name: repoInfo.repo } };
    }
  } catch { /* non-git workspace — cloud sandbox without repo context */ }
  return {};
}

/**
 * Wait for a cloud session's remote worker to report `session.start` before
 * sending prompts. Until `hasSessionStarted` flips inside the runtime, calls
 * to `session.send` are silently swallowed (the runtime logs an error but
 * `sendForSchema` still resolves with a fresh messageId). See
 * copilot-agent-runtime: src/core/remote/remoteSession.ts:assertRemoteSessionStarted
 * and src/core/session.ts:sendForSchema (RemoteSession override).
 */
async function waitForCloudSessionStart(
  session: CopilotSession,
  agentId: string,
  timeoutMs = 60_000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { (off as any)?.(); } catch { /* ignore */ }
      reject(new Error(`Cloud session did not emit session.start within ${timeoutMs}ms`));
    }, timeoutMs);
    const off = (session as any).on('session.start', (event: any) => {
      const data = event?.data ?? event;
      // For cloud sessions, the runtime emits session.start ONLY when the
      // remote copilot-agent worker has connected (producer: "copilot-agent",
      // remoteSteerable: true). Local placeholder events don't fire this.
      console.log(
        `[sdk-send] agent=${agentId.slice(0, 8)} cloud session.start received ` +
        `(producer=${data?.producer ?? '?'}, remoteSteerable=${data?.remoteSteerable ?? '?'})`,
      );
      clearTimeout(timer);
      try { (off as any)?.(); } catch { /* ignore */ }
      resolve();
    });
  });
}

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

function shouldEnableWhimTools(spaceId?: string | null): boolean {
  return !spaceId || spaceId === '__workspace__';
}

function createCustomToolsContext(agentId: string, enableWhimTools = false): CustomToolsContext {
  if (!enableWhimTools) {
    return { agentId, broker };
  }

  return {
    agentId,
    broker,
    enableWhimTools: true,
    registry,
    getSpaces: () =>
      listSpaces().map((space) => ({
        id: space.id,
        description: space.description,
        body: space.body,
        status: space.status,
        folder: space.folder,
      })),
    setYoloMode: async (targetAgentId: string, enabled: boolean) => {
      const record = registry.get(targetAgentId);
      if (!record) return { error: 'Agent not found' };

      record.yoloMode = enabled;
      console.log(`[agent-service] yolo mode ${enabled ? 'enabled' : 'disabled'} for agent=${targetAgentId}`);
      notifier.notifyRenderer('agent:yolo-changed', { agentId: targetAgentId, enabled });

      if (enabled && record.pendingApprovals.size > 0) {
        for (const requestId of [...record.pendingApprovals.keys()]) {
          broker.approveAgent(targetAgentId, requestId, true);
        }
      }

      return { ok: true };
    },
    sendChatMessage: async (targetAgentId: string, prompt: string) => sendChatMessage(targetAgentId, prompt),
    getAgentHistory: async (targetAgentId: string) => getAgentHistory(targetAgentId),
  };
}

/** Build a system prompt fragment describing available CLI tools */
export function buildCliToolsPrompt(): string {
  const tools = getConfigValue('cliTools') || [];
  if (tools.length === 0) return '';
  const lines = tools.map((t: { name: string; description: string }) => `- \`${t.name}\`: ${t.description}`);
  return `\n\nThe following CLI tools may be available in the environment (verify before use):\n${lines.join('\n')}`;
}

/**
 * Resolve skill config for a canvas-based session.
 * Reads the canvas frontmatter `skills` array and computes the
 * `skillDirectories` + `disabledSkills` config for createSession.
 * Returns undefined if no skills are linked (avoids auto-loading).
 */
export function resolveLinkedSkillConfig(
  canvasContent: string,
  workspaceRoot: string,
): { skillDirectories: string[]; disabledSkills: string[] } | undefined {
  const { frontmatter } = parseFrontmatter(canvasContent);
  const linkedIds: string[] = Array.isArray(frontmatter.skills) ? frontmatter.skills : [];
  if (linkedIds.length === 0) return undefined;

  const skillsDir = path.join(workspaceRoot, '.agents', 'skills');
  const allSkills = listSkills();
  const linkedSet = new Set(linkedIds);
  const disabledSkills = allSkills
    .filter(s => !linkedSet.has(s.id))
    .map(s => s.name);

  return { skillDirectories: [skillsDir], disabledSkills };
}

export async function launchAgent(
  spaceId: string,
  selectedText: string,
  anchor: AgentAnchor,
  workspaceRoot: string,
  spaceFolder: string,
  _options?: { repo?: string; model?: string }
): Promise<{ agentId: string; sessionId: string } | { error: string }> {
  const client = getCopilotClient();
  if (!client) {
    return { error: 'Copilot SDK not initialized' };
  }

  const agentId = uuid();
  const workingDir = path.join(workspaceRoot, spaceFolder);

  // Snapshot canvas hash for change detection on completion
  const canvasPath = path.join(workingDir, 'canvas.md');
  let canvasHashBefore = '';
  let canvasContentRaw = '';
  try {
    canvasContentRaw = fs.readFileSync(canvasPath, 'utf-8');
    canvasHashBefore = crypto.createHash('md5').update(canvasContentRaw).digest('hex');
  } catch { /* file may not exist yet */ }

  // Resolve linked skills from canvas frontmatter
  const skillConfig = resolveLinkedSkillConfig(canvasContentRaw, workspaceRoot);

  try {
    const mcpServers = getAllMcpServers();
    const cliToolsPrompt = buildCliToolsPrompt();
    const findRecord = (sid: string) => registry.findBySessionId(sid);

    const session = await client.createSession({
      workingDirectory: workingDir,
      streaming: true,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      tools: getCustomTools(createCustomToolsContext(agentId)),
      onPermissionRequest: broker.createPermissionHandler(findRecord),
      onUserInputRequest: broker.createUserInputHandler(findRecord),
      onElicitationRequest: broker.createElicitationHandler(findRecord),
      ...(skillConfig ? { skillDirectories: skillConfig.skillDirectories, disabledSkills: skillConfig.disabledSkills } : {}),
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
      spaceId,
      selectedText,
      anchor,
      status: 'running',
      pendingApprovalId: null,
      pendingPermissionKind: null,
      pendingApprovals: new Map(),
      summary: 'Starting...',
      canvasSnapshot: { path: canvasPath, hashBefore: canvasHashBefore },
    };
    registry.set(agentId, record);

    // Persist to DB (both canvas_agents for backward compat + agent_sessions as central registry)
    persistence.createCanvasAgentRecord({
      id: agentId,
      space_id: spaceId,
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
      space_id: spaceId,
      prompt: selectedText,
      status: 'running',
      summary: 'Starting...',
      working_dir: workingDir,
      source: 'sdk',
      persona_handle: null,
      quoted_text: null,
      created_at: now,
      updated_at: now,
    });

    // Set up event listeners
    setupAgentEventListeners(session, record);

    // Auto-enable remote if the user has opted into auto-remote for all workers
    if (getConfigValue('remoteAutoEnable')) {
      enableRemoteControl(agentId).catch((err: any) => {
        console.error(`[sdk-runner] Auto-enable remote failed for agent=${agentId}:`, err);
      });
    }

    // Log to per-space activity log
    logIntentActivity(record, 'agent.launched', {
      sessionId,
      prompt: truncate(selectedText, 200),
      cwd: workingDir,
    });

    // Fire-and-forget: return agentId immediately so the renderer can subscribe
    // before events start flowing. Errors are handled by the session.error listener.
    console.log(`[sdk-send] launchAgent agent=${agentId.slice(0, 8)} calling session.send`);
    session.send({
      prompt: selectedText,
      attachments: [{ type: 'file' as const, path: path.join(workingDir, 'canvas.md'), displayName: 'canvas.md' }],
    })
      .then((mid: any) => { console.log(`[sdk-send] launchAgent agent=${agentId.slice(0, 8)} resolved messageId=${mid ?? '<undefined>'}`); })
      .catch((err: any) => {
      console.error(`[sdk-send] launchAgent agent=${agentId.slice(0, 8)} REJECTED:`, err?.message ?? err);
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
  const isEphemeral = persona?.ephemeral === true;
  const isCloudSandbox = persona?.runLocation === 'cloud';
  // Cloud sessions use the regular client — the cloud environment provides its
  // own filesystem so we avoid the sessionFs + cloud interaction on the
  // ephemeral client.
  const client = (isEphemeral && !isCloudSandbox) ? getEphemeralCopilotClient() : getCopilotClient();
  if (!client) {
    return { error: isEphemeral ? 'Ephemeral Copilot client not initialized' : 'Copilot SDK not initialized' };
  }

  const agentId = uuid();

  try {
    const cliToolsPrompt = buildCliToolsPrompt();
    const findRecord = (sid: string) => registry.findBySessionId(sid);

    const customToolsContext = createCustomToolsContext(agentId, true);
    const sandboxSetup = persona
      ? buildSandboxLaunchSetup({
        agentId,
        workingDir: workspaceRoot,
        persona,
        registry,
        broker,
        customToolsContext,
      })
      : null;
    const isSandboxed = sandboxSetup?.isSandboxed === true;
    const sandboxConfigs = sandboxSetup?.sandboxConfigs ?? null;
    const mcpServers = sandboxSetup ? sandboxSetup.mcpServers : getAllMcpServers();
    const customTools = sandboxSetup ? sandboxSetup.customTools : getCustomTools(customToolsContext);
    const sandboxState = sandboxSetup?.sandboxState;
    const hooks = sandboxSetup?.hooks;
    const enforcementMode = sandboxSetup?.enforcementMode ?? 'both';
    // Permission-handler routing:
    //   - both     → path-aware sandbox handler (host-side path checks +
    //                bubble-up dialog for out-of-scope writes)
    //   - mxc-only → auto-approve handler (MXC is sole enforcer; SDK calls
    //                proceed to MXC for shell, unrestricted for SDK file ops)
    //   - non-sandboxed → regular interactive handler
    const useHostPathAwareHandler = isSandboxed && enforcementMode === 'both';
    const useMxcOnlyAutoApprove = isSandboxed && enforcementMode === 'mxc-only';

    // When a persona is supplied, prepend its instructions to the system message
    // and use its preferred model.  Persona handles are matched against the
    // 'personas' config; cloud routing happens in the IPC handler so this path
    // only handles local and cloud sessions.
    const personaPreamble = persona ? `${persona.instructions}\n\n` : '';
    const baseSystemContent = `${personaPreamble}${cliToolsPrompt}`.trim();
    // In mxc-only mode the host-side guards are deliberately suppressed so MXC
    // is the sole enforcer; the agent must NOT be told it's sandboxed,
    // otherwise we can't observe MXC's own denials. Only append the
    // [SANDBOX MODE] fragment when host-side guards are also active.
    const systemContent = isSandboxed && enforcementMode === 'both'
      ? `${baseSystemContent}${SANDBOX_WORKSPACE_SYSTEM_PROMPT}`
      : baseSystemContent;

    // Resolve cloud session options for cloud personas
    const cloudOpts = isCloudSandbox ? await resolveCloudSessionOptions(workspaceRoot) : undefined;

    const sessionConfig = {
      workingDirectory: workspaceRoot,
      streaming: true,
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
      ...((isEphemeral && !isCloudSandbox) ? { createSessionFsHandler: () => new InMemoryFsProvider() } : {}),
      ...(cloudOpts ? { cloud: cloudOpts } : {}),
      onPermissionRequest: useHostPathAwareHandler
        ? broker.createPathAwareSandboxPermissionHandler(findRecord)
        : useMxcOnlyAutoApprove
          ? broker.createMxcOnlyPermissionHandler(findRecord)
          : broker.createPermissionHandler(findRecord),
      onUserInputRequest: broker.createUserInputHandler(findRecord),
      onElicitationRequest: broker.createElicitationHandler(findRecord),
    };

    const session = await client.createSession(sessionConfig);

    // The runtime does NOT auto-load sandbox enforcement from configDir. We
    // must explicitly push the sandboxConfig via options.update so MXC
    // wraps shell commands with sandbox-exec. This MUST resolve before
    // session.send so the first tool call is gated.
    // See cli/promptMode.ts:346 for the reference implementation; the
    // configDir we set above only isolates per-session-state (events, hooks).
    if (isSandboxed && sandboxSetup?.runtimeSandboxConfig && !isCloudSandbox) {
      try {
        const result = await (session as any).rpc.options.update({
          sandboxConfig: sandboxSetup.runtimeSandboxConfig,
        });
        if (result?.success === false) {
          console.error(
            `[sandbox] options.update returned success=false for agent ${agentId}; ` +
            `aborting launch to avoid running unsandboxed.`,
          );
          try { await (session as any).abort?.(); } catch { /* best-effort */ }
          return { error: 'Failed to apply sandbox configuration (runtime rejected the update)' };
        }
        console.log(`[sandbox] applied runtime sandbox enforcement for agent ${agentId}`);
      } catch (err: any) {
        console.error(
          `[sandbox] options.update threw for agent ${agentId}: ${err?.message ?? err}; ` +
          `aborting launch to avoid running unsandboxed.`,
        );
        try { await (session as any).abort?.(); } catch { /* best-effort */ }
        return { error: `Failed to apply sandbox configuration: ${err?.message ?? 'unknown error'}` };
      }
    }

    const sessionId = (session as any).sessionId || agentId;
    const now = new Date().toISOString();

    const summary = persona ? `Starting as @${persona.handle}...` : 'Starting...';

    const record: AgentRecord = {
      agentId,
      sessionId,
      session,
      spaceId: '__workspace__',
      selectedText: prompt,
      anchor: { quote: '', prefix: '', suffix: '' },
      status: 'running',
      pendingApprovalId: null,
      pendingPermissionKind: null,
      pendingApprovals: new Map(),
      summary,
      ...(sandboxState ? { sandbox: sandboxState } : {}),
      ...(persona?.yolo ? { yoloMode: true } : {}),
      ...(persona?.handle ? { personaHandle: persona.handle } : {}),
      ...(isEphemeral ? { ephemeral: true } : {}),
    };
    registry.set(agentId, record);

    // Notify renderer of yolo mode if persona enables it
    if (persona?.yolo) {
      notifier.notifyRenderer('agent:yolo-changed', { agentId, enabled: true });
    }

    if (!isEphemeral) {
      persistence.createAgentSessionRecord({
        id: agentId,
        session_id: sessionId,
        space_id: null,
        prompt,
        status: 'running',
        summary,
        working_dir: workspaceRoot,
        source: 'sdk',
        persona_handle: persona?.handle ?? null,
        quoted_text: null,
        created_at: now,
        updated_at: now,
      });
    }

    setupAgentEventListeners(session, record);

    // Auto-enable remote if the user has opted into auto-remote for all workers
    if (getConfigValue('remoteAutoEnable')) {
      enableRemoteControl(agentId).catch((err: any) => {
        console.error(`[sdk-runner] Auto-enable remote failed for agent=${agentId}:`, err);
      });
    }

    // before events start flowing. Errors are handled by the session.error listener.
    // Cloud sessions: wait for the remote worker's session.start event before
    // sending — otherwise the runtime swallows the prompt silently (see
    // waitForCloudSessionStart helper for details).
    console.log(`[sdk-send] agent=${agentId.slice(0, 8)} calling session.send promptLen=${prompt.length}${isCloudSandbox ? ' (after cloud start)' : ''}`);
    const readyPromise = isCloudSandbox
      ? waitForCloudSessionStart(session, agentId)
      : Promise.resolve();
    readyPromise
      .then(() => session.send({ prompt }))
      .then((messageId: any) => {
        console.log(`[sdk-send] agent=${agentId.slice(0, 8)} session.send resolved messageId=${messageId ?? '<undefined>'}`);
      })
      .catch((err: any) => {
        console.error(`[sdk-send] agent=${agentId.slice(0, 8)} session.send REJECTED:`, err?.message ?? err);
        record.status = 'failed';
        record.summary = `Error: ${err.message || 'Unknown'}`;
        if (!record.ephemeral) persistence.updateStatus(record);
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

/** Launch an SDK agent with the full canvas document as context, using the space folder as cwd. */
export async function launchDocumentAgent(
  spaceId: string,
  workspaceRoot: string,
  spaceFolder: string,
): Promise<{ agentId: string; sessionId: string } | { error: string }> {
  const client = getCopilotClient();
  if (!client) {
    return { error: 'Copilot SDK not initialized' };
  }

  const agentId = uuid();
  const workingDir = path.join(workspaceRoot, spaceFolder);

  // Read the full canvas document
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

  // Snapshot canvas hash for change detection on completion
  const canvasHashBefore = crypto.createHash('md5').update(documentContent).digest('hex');

  // Resolve linked skills from canvas frontmatter
  const skillConfig = resolveLinkedSkillConfig(documentContent, workspaceRoot);

  try {
    const mcpServers = getAllMcpServers();
    const cliToolsPrompt = buildCliToolsPrompt();
    const findRecord = (sid: string) => registry.findBySessionId(sid);

    const session = await client.createSession({
      workingDirectory: workingDir,
      streaming: true,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      tools: getCustomTools(createCustomToolsContext(agentId)),
      onPermissionRequest: broker.createPermissionHandler(findRecord),
      onUserInputRequest: broker.createUserInputHandler(findRecord),
      onElicitationRequest: broker.createElicitationHandler(findRecord),
      ...(skillConfig ? { skillDirectories: skillConfig.skillDirectories, disabledSkills: skillConfig.disabledSkills } : {}),
      systemMessage: {
        mode: 'append',
        content: `\nThe user has pressed "Run" on their space document. Execute all instructions in the document below. The full document is also available as canvas.md in your working directory.\n\n---\n${documentContent}\n---\n${cliToolsPrompt}`,
      },
    });

    const sessionId = (session as any).sessionId || agentId;
    const now = new Date().toISOString();

    const record: AgentRecord = {
      agentId,
      sessionId,
      session,
      spaceId,
      selectedText: documentContent,
      anchor: { quote: '', prefix: '', suffix: '' },
      status: 'running',
      pendingApprovalId: null,
      pendingPermissionKind: null,
      pendingApprovals: new Map(),
      summary: 'Executing document...',
      canvasSnapshot: { path: canvasPath, hashBefore: canvasHashBefore },
    };
    registry.set(agentId, record);

    persistence.createCanvasAgentRecord({
      id: agentId,
      space_id: spaceId,
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
      space_id: spaceId,
      prompt: truncate(documentContent, 500),
      status: 'running',
      summary: 'Executing document...',
      working_dir: workingDir,
      source: 'sdk',
      persona_handle: null,
      quoted_text: null,
      created_at: now,
      updated_at: now,
    });

    setupAgentEventListeners(session, record);

    // Auto-enable remote if the user has opted into auto-remote for all workers
    if (getConfigValue('remoteAutoEnable')) {
      enableRemoteControl(agentId).catch((err: any) => {
        console.error(`[sdk-runner] Auto-enable remote failed for agent=${agentId}:`, err);
      });
    }

    // Log to per-space activity log
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
 * Disable the sandbox for the rest of an agent's session.  Calls
 * `session.rpc.options.update({ sandboxConfig: { enabled: false } })` on the
 * existing session — no session swap needed. The runtime drops its sandboxed
 * shell context and restarts MCP stdio servers in response, so subsequent
 * tool calls run unsandboxed.
 *
 * Idempotent: returns silently when the agent is unknown, already disabled,
 * or non-sandboxed.
 *
 * Ordering: callers should `await` this BEFORE resolving the pending
 * sandbox-block broker callback so that the unblocked tool call runs after
 * the runtime has actually disabled enforcement.
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

  try {
    const result = await (record.session as any).rpc.options.update({
      sandboxConfig: { enabled: false },
    });
    if (result?.success === false) {
      throw new Error('runtime rejected sandbox disable');
    }

    record.sandbox.state = 'off';
    record.status = 'running';
    persistence.updateStatus(record);

    notifier.notifyRenderer(`chat:event:${agentId}`, {
      type: 'sandbox.disabled',
      reason: 'user-requested',
    });
    notifier.notifyRenderer('agent:status-changed', {
      agentId, status: 'running', summary: 'Sandbox disabled',
    });

    // Re-prompt the agent so it retries the just-blocked operation now that
    // enforcement is off. Fire-and-forget; errors surface via the session
    // error listener.
    record.session.send({
      prompt: 'Sandbox is now disabled. Please retry the operation that was just blocked.',
    }).catch((err: any) => {
      console.error(`[agent-service] retry-after-disable send failed for ${agentId}:`, err);
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
    const customToolsContext = createCustomToolsContext(agentId, shouldEnableWhimTools(persisted.space_id));

    // Use resumeSession to restore full conversation history (not createSession
    // which would start a fresh session with no history).
    const session = await client.resumeSession(persisted.session_id, {
      workingDirectory: workingDir,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      tools: getCustomTools(customToolsContext),
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
      spaceId: persisted.space_id || '__workspace__',
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
    const customToolsContext = createCustomToolsContext(agentId, shouldEnableWhimTools(persisted.space_id));

    const isCanvasAgent = persisted.space_id && persisted.space_id !== '__workspace__';

    // Resolve linked skills for canvas agents (read from current canvas content)
    let skillConfig: { skillDirectories: string[]; disabledSkills: string[] } | undefined;
    if (isCanvasAgent) {
      try {
        const canvasPath = path.join(workingDir, 'canvas.md');
        if (fs.existsSync(canvasPath)) {
          const canvasContent = fs.readFileSync(canvasPath, 'utf-8');
          // workingDir is workspace/spaceFolder — go up one level for workspace root
          const workspaceRoot = path.dirname(workingDir);
          skillConfig = resolveLinkedSkillConfig(canvasContent, workspaceRoot);
        }
      } catch { /* proceed without skills */ }
    }

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
      streaming: true,
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      tools: getCustomTools(customToolsContext),
      onPermissionRequest: broker.createPermissionHandler(findRecord),
      onUserInputRequest: broker.createUserInputHandler(findRecord),
      onElicitationRequest: broker.createElicitationHandler(findRecord),
      ...(skillConfig ? { skillDirectories: skillConfig.skillDirectories, disabledSkills: skillConfig.disabledSkills } : {}),
      systemMessage: { mode: 'append', content: systemContent },
    });

    const newSessionId = (session as any).sessionId || agentId;

    const record: AgentRecord = {
      agentId,
      sessionId: newSessionId,
      session,
      spaceId: persisted.space_id || '__workspace__',
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
    const events = await record.session.getEvents();
    return { events: events || [], ...(restarted ? { restarted: true } : {}) };
  } catch (err: any) {
    console.error('[agent-service] Failed to get history:', err);
    return { error: err.message || 'Failed to load conversation history' };
  }
}

// ── Event Listener Setup ──────────────────────────────────────

/** Resolve workspace + spaceFolder for activity logging. Returns null if unavailable. */
function resolveSpaceActivityContext(record: AgentRecord): { workspaceRoot: string; spaceFolder: string } | null {
  if (!record.spaceId || record.spaceId === '__workspace__') return null;
  const workspace = getConfigValue('workspace');
  if (!workspace) return null;
  try {
    const { getSpace } = require('../database');
    const space = getSpace(record.spaceId);
    if (!space?.folder) return null;
    return { workspaceRoot: workspace, spaceFolder: space.folder };
  } catch { return null; }
}

/** Append to the per-space activity log (non-fatal on failure). */
function logIntentActivity(record: AgentRecord, type: string, data: Record<string, any>): void {
  if (record.ephemeral) return;
  const ctx = resolveSpaceActivityContext(record);
  if (!ctx) return;
  appendSpaceActivity(ctx.workspaceRoot, ctx.spaceFolder, type, { agentId: record.agentId, ...data });
}

export function setupAgentEventListeners(session: CopilotSession, record: AgentRecord): void {
  const agentId = record.agentId;
  const chatChannel = `chat:event:${agentId}`;

  // TEMP DIAGNOSTIC: log every event received by this session so we can
  // diagnose silent agents after the SDK link. Remove once cloud + local
  // sessions are confirmed working with the new SDK.
  session.on((event: any) => {
    try {
      const t = event?.type ?? '?';
      // For warning/error/info events, also dump the payload so we can see
      // what the runtime is complaining about (e.g. 'no model available').
      if (t === 'session.warning' || t === 'session.error' || t === 'session.info' || t === 'session.start') {
        let data: string;
        try { data = JSON.stringify(event?.data ?? event, null, 0).slice(0, 500); }
        catch { data = String(event?.data ?? event); }
        console.log(`[sdk-event] agent=${agentId.slice(0, 8)} type=${t} data=${data}`);
      } else {
        console.log(`[sdk-event] agent=${agentId.slice(0, 8)} type=${t}`);
      }
    } catch { /* never let logging break dispatch */ }
  });

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

      // Fallback canvas change detection for ALL agent types.
      // The file watcher handles real-time detection while the canvas is open,
      // but this catches changes when the canvas was closed or the watcher missed something.
      if (record.canvasSnapshot && !record.commentContext) {
        try {
          const newContent = fs.readFileSync(record.canvasSnapshot.path, 'utf-8');
          const currentHash = crypto.createHash('md5').update(newContent).digest('hex');
          if (record.canvasSnapshot.hashBefore && currentHash !== record.canvasSnapshot.hashBefore) {
            updateCanvasContent(record.spaceId, newContent);
            notifier.notifyRenderer('canvas:content-updated', {
              spaceId: record.spaceId,
              content: newContent,
            });
          }
        } catch { /* non-fatal: file may not exist */ }
      }

      // Ephemeral agents: remove from registry after a short delay so the
      // renderer has time to process final events, then they vanish from history.
      if (record.ephemeral) {
        setTimeout(() => registry.delete(agentId), 30_000);
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
      notifier.notifyRenderer('agent:presence-ended', { agentId, spaceId: record.spaceId });
    }

    // Clean up per-agent sandbox config dirs on failure
    if (record.sandbox) {
      const { cleanupSandboxConfigs } = require('../ai');
      cleanupSandboxConfigs(agentId);
    }

    if (record.ephemeral) {
      setTimeout(() => registry.delete(agentId), 30_000);
    }
  });

  // Sub-agent tracking via catch-all listener
  installSubagentSubscription(session, record);

  // Remote steering state changes
  session.on('session.remote_steerable_changed' as any, (event: any) => {
    const d = event.data ?? event;
    const remoteSteerable = !!d.remoteSteerable;
    if (record.remote) {
      record.remote.remoteSteerable = remoteSteerable;
    }
    notifier.notifyRenderer('agent:remote-changed', {
      agentId,
      enabled: record.remote?.enabled ?? false,
      remoteSteerable,
      url: record.remote?.url,
    });
  });

  // Capture remote URL emitted by the runtime as session.info{infoType:"remote"}.
  // Cloud sessions emit this automatically once the remote worker connects
  // (URL like https://github.com/copilot/tasks/{id}). Local sessions only emit
  // it when the user enables remote control explicitly. Either way, record
  // the URL so the renderer can surface a shareable link without the user
  // having to call enableRemoteControl first.
  session.on('session.info' as any, (event: any) => {
    const d = event.data ?? event;
    if (d?.infoType !== 'remote' || !d?.url) return;
    const url: string = d.url;
    const prev = record.remote;
    record.remote = {
      enabled: true,
      remoteSteerable: prev?.remoteSteerable ?? true,
      url,
    };
    if (prev?.url === url && prev?.enabled === true) return;
    notifier.notifyRenderer('agent:remote-changed', {
      agentId,
      enabled: true,
      remoteSteerable: record.remote.remoteSteerable,
      url,
    });
  });
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

// ── Remote control ─────────────────────────────────────

export async function enableRemoteControl(agentId: string): Promise<{ enabled: boolean; remoteSteerable: boolean; url?: string } | { error: string }> {
  const record = registry.get(agentId);
  if (!record) return { error: 'Agent not found' };

  try {
    const result = await record.session.rpc.remote.enable({ mode: 'on' });
    if (!result.url) {
      console.warn(`[sdk-runner] remote.enable returned no URL for agent=${agentId}. Result:`, JSON.stringify(result));
    }
    record.remote = {
      enabled: true,
      remoteSteerable: result.remoteSteerable,
      url: result.url,
    };
    notifier.notifyRenderer('agent:remote-changed', {
      agentId,
      enabled: true,
      remoteSteerable: result.remoteSteerable,
      url: result.url,
    });
    return { enabled: true, remoteSteerable: result.remoteSteerable, url: result.url };
  } catch (err: any) {
    return { error: err.message || 'Failed to enable remote control' };
  }
}

export async function disableRemoteControl(agentId: string): Promise<{ ok: true } | { error: string }> {
  const record = registry.get(agentId);
  if (!record) return { error: 'Agent not found' };

  try {
    await record.session.rpc.remote.disable();
    record.remote = { enabled: false, remoteSteerable: false };
    notifier.notifyRenderer('agent:remote-changed', {
      agentId,
      enabled: false,
      remoteSteerable: false,
    });
    return { ok: true };
  } catch (err: any) {
    return { error: err.message || 'Failed to disable remote control' };
  }
}

/**
 * Return the current remote control state for an agent.  Used by the renderer
 * to restore overlay state on mount so the link sticks for the life of the
 * session even if the chat view remounts.
 */
export function getRemoteState(
  agentId: string,
): { enabled: boolean; remoteSteerable: boolean; url?: string } | { error: string } {
  const record = registry.get(agentId);
  if (!record) return { error: 'Agent not found' };
  return record.remote
    ? { enabled: record.remote.enabled, remoteSteerable: record.remote.remoteSteerable, url: record.remote.url }
    : { enabled: false, remoteSteerable: false };
}

/**
 * Force-reset remote control on an agent by disabling then re-enabling it.
 * Performs the disable/enable atomically with respect to renderer events:
 * emits exactly ONE final `agent:remote-changed` so the renderer never sees
 * the intermediate "disabled" state and overlays don't flicker.
 *
 * Returns `changed: true` if the URL rotated, `changed: false` if the SDK
 * returned the same URL (so callers can show a meaningful hint to the user).
 */
export async function resetRemoteControl(
  agentId: string,
): Promise<{ enabled: boolean; remoteSteerable: boolean; url?: string; changed: boolean } | { error: string }> {
  const record = registry.get(agentId);
  if (!record) return { error: 'Agent not found' };

  const oldUrl = record.remote?.url;

  try {
    await record.session.rpc.remote.disable();
  } catch (err: any) {
    console.error(`[sdk-runner] reset: disable failed for agent=${agentId}:`, err);
    return { error: err.message || 'Failed to disable remote control during reset' };
  }

  try {
    const result = await record.session.rpc.remote.enable({ mode: 'on' });
    record.remote = {
      enabled: true,
      remoteSteerable: result.remoteSteerable,
      url: result.url,
    };
    notifier.notifyRenderer('agent:remote-changed', {
      agentId,
      enabled: true,
      remoteSteerable: result.remoteSteerable,
      url: result.url,
    });
    return {
      enabled: true,
      remoteSteerable: result.remoteSteerable,
      url: result.url,
      changed: oldUrl !== result.url,
    };
  } catch (err: any) {
    console.error(`[sdk-runner] reset: enable failed for agent=${agentId}:`, err);
    record.remote = { enabled: false, remoteSteerable: false };
    notifier.notifyRenderer('agent:remote-changed', {
      agentId,
      enabled: false,
      remoteSteerable: false,
    });
    return { error: err.message || 'Failed to re-enable remote control during reset' };
  }
}
