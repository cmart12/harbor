import { v4 as uuid } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { getCopilotClient } from '../ai';
import { type AgentPersona } from '../config';
import { AgentRegistry } from './agent-registry';
import type { AgentRecord } from './agent-registry';
import { AgentNotifier } from './agent-notifier';
import { AgentPersistence } from './agent-persistence';
import { InteractionBroker } from './interaction-broker';
import { buildCliToolsPrompt } from './sdk-runner';
import { buildSandboxLaunchSetup } from './sandbox-launch';
import { SANDBOX_SYSTEM_PROMPT } from './sandbox-policies';
import { getWorkspaceRepo } from '../cloud-agent';

/** Shared dependencies injected from agent-service at init time. */
let registry: AgentRegistry;
let notifier: AgentNotifier;
let persistence: AgentPersistence;
let broker: InteractionBroker;

// Keep a reference to setupAgentEventListeners from sdk-runner
let setupListeners: (session: any, record: AgentRecord) => void;

export function initCommentWorkflow(deps: {
  registry: AgentRegistry;
  notifier: AgentNotifier;
  persistence: AgentPersistence;
  broker: InteractionBroker;
  setupAgentEventListeners: (session: any, record: AgentRecord) => void;
}): void {
  registry = deps.registry;
  notifier = deps.notifier;
  persistence = deps.persistence;
  broker = deps.broker;
  setupListeners = deps.setupAgentEventListeners;
}

/** Launch an agent session triggered by an @mention in a canvas comment */
export async function launchCommentAgent(
  spaceId: string,
  commentBody: string,
  quotedText: string,
  anchor: { prefix?: string; suffix?: string },
  persona: AgentPersona,
  threadId: string | null,
  workspaceRoot: string,
  intentFolder: string,
): Promise<{ agentId: string; sessionId: string } | { error: string }> {
  const client = getCopilotClient();
  if (!client) {
    return { error: 'Copilot SDK not initialized' };
  }

  const agentId = uuid();
  const workingDir = path.join(workspaceRoot, intentFolder);
  const canvasPath = path.join(workingDir, 'canvas.md');

  // Snapshot canvas hash for change detection
  let canvasHashBefore = '';
  try {
    const canvasContent = fs.readFileSync(canvasPath, 'utf-8');
    canvasHashBefore = crypto.createHash('md5').update(canvasContent).digest('hex');
  } catch { /* file may not exist yet */ }

  try {
    const cliToolsPrompt = buildCliToolsPrompt();
    const findRecord = (sid: string) => registry.findBySessionId(sid);

    const sandboxSetup = buildSandboxLaunchSetup({
      agentId,
      workingDir,
      persona,
      registry,
      broker,
    });
    const { isSandboxed, sandboxConfigs, mcpServers, customTools, sandboxState, hooks, enforcementMode } = sandboxSetup;
    // Permission-handler routing:
    //   - both     → path-aware sandbox handler (host-side path checks +
    //                bubble-up dialog for out-of-scope writes)
    //   - mxc-only → auto-approve handler (MXC is sole enforcer; SDK calls
    //                proceed to MXC for shell, unrestricted for SDK file ops)
    //   - non-sandboxed → regular interactive handler
    const useHostPathAwareHandler = isSandboxed && enforcementMode === 'both';
    const useMxcOnlyAutoApprove = isSandboxed && enforcementMode === 'mxc-only';

    const systemPrompt = `${persona.instructions}

You are responding to a comment on a canvas document. The user wrote:

Comment: "${commentBody}"
On this text: "${quotedText}"

The full canvas document is available as canvas.md in the working directory.
If you make changes to the document, clearly describe what you changed.${cliToolsPrompt}`;

    // Resolve cloud session options for cloud personas
    const isCloudSandbox = persona.runLocation === 'cloud';
    let cloudOpts: { repository?: { owner: string; name: string } } | undefined;
    if (isCloudSandbox) {
      try {
        const repoInfo = await getWorkspaceRepo(workingDir);
        cloudOpts = repoInfo ? { repository: { owner: repoInfo.owner, name: repoInfo.repo } } : {};
      } catch { cloudOpts = {}; }
    }

    const session = await client.createSession({
      workingDirectory: workingDir,
      ...(sandboxConfigs ? { configDir: sandboxConfigs.onDir } : {}),
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      tools: customTools,
      ...(persona.model ? { model: persona.model } : {}),
      ...(hooks ? { hooks } : {}),
      ...(cloudOpts ? { cloud: cloudOpts } : {}),
      onPermissionRequest: useHostPathAwareHandler
        ? broker.createPathAwareSandboxPermissionHandler(findRecord)
        : useMxcOnlyAutoApprove
          ? broker.createMxcOnlyPermissionHandler(findRecord)
          : broker.createPermissionHandler(findRecord),
      onUserInputRequest: broker.createUserInputHandler(findRecord),
      onElicitationRequest: broker.createElicitationHandler(findRecord),
      systemMessage: {
        mode: 'append',
        // In mxc-only mode the host-side guards are deliberately suppressed so
        // MXC is the sole enforcer; the agent must NOT be told it's sandboxed,
        // otherwise we can't observe MXC's own denials. Only append the
        // [SANDBOX MODE] fragment when host-side guards are also active.
        content: isSandboxed && enforcementMode === 'both'
          ? `\n${systemPrompt}${SANDBOX_SYSTEM_PROMPT}`
          : `\n${systemPrompt}`,
      },
    });

    const sessionId = (session as any).sessionId || agentId;
    const now = new Date().toISOString();

    const record: AgentRecord = {
      agentId,
      sessionId,
      session,
      spaceId,
      selectedText: commentBody,
      anchor: { quote: quotedText, prefix: anchor.prefix || '', suffix: anchor.suffix || '' },
      status: 'running',
      pendingApprovalId: null,
      pendingPermissionKind: null,
      pendingApprovals: new Map(),
      summary: 'Starting...',
      ...(sandboxState ? { sandbox: sandboxState } : {}),
      ...(persona.yolo ? { yoloMode: true } : {}),
      commentContext: {
        threadId,
        personaHandle: persona.handle,
        personaName: persona.handle,
        commentBody,
        quotedText,
        anchor,
        canvasHashBefore,
        canvasPath,
      },
    };
    registry.set(agentId, record);

    if (persona.yolo) {
      notifier.notifyRenderer('agent:yolo-changed', { agentId, enabled: true });
    }

    persistence.createAgentSessionRecord({
      id: agentId,
      session_id: sessionId,
      space_id: spaceId,
      prompt: commentBody,
      status: 'running',
      summary: 'Starting...',
      working_dir: workingDir,
      source: 'sdk',
      persona_handle: persona.handle,
      quoted_text: quotedText || null,
      created_at: now,
      updated_at: now,
    });

    setupListeners(session, record);

    // Notify renderer to show presence
    notifier.notifyRenderer('agent:presence-started', {
      agentId,
      spaceId,
      persona: { name: persona.handle, handle: persona.handle },
      anchor,
      ...(threadId ? { threadId } : {}),
    });

    session.send({
      prompt: commentBody,
      attachments: [{ type: 'file' as const, path: canvasPath, displayName: 'canvas.md' }],
    }).catch((err: any) => {
      record.status = 'failed';
      record.summary = `Error: ${err.message || 'Unknown'}`;
      persistence.updateStatus(record);
      notifier.notifyRenderer(`chat:event:${agentId}`, {
        type: 'session.error',
        message: err.message || 'Failed to process message',
      });
      if (record.commentContext) {
        notifier.notifyRenderer('agent:presence-ended', { agentId, spaceId: record.spaceId });
      }
    });

    return { agentId, sessionId };
  } catch (err: any) {
    return { error: err.message || 'Failed to launch comment agent' };
  }
}

export function handleCommentAgentCompletion(record: AgentRecord): void {
  const ctx = record.commentContext;
  if (!ctx) return;

  // End presence
  notifier.notifyRenderer('agent:presence-ended', {
    agentId: record.agentId,
    spaceId: record.spaceId,
  });

  // Detect if agent modified canvas.md (for reply message only —
  // the file watcher + sdk-runner fallback handle the actual content push)
  let documentChanged = false;
  try {
    const newContent = fs.readFileSync(ctx.canvasPath, 'utf-8');
    const currentHash = crypto.createHash('md5').update(newContent).digest('hex');
    documentChanged = ctx.canvasHashBefore !== '' && currentHash !== ctx.canvasHashBefore;
  } catch { /* non-fatal */ }

  // Send reply to renderer
  const replyBody = documentChanged
    ? `[bot] I've made changes to the document. Ready for your review.`
    : `[bot] ${record.summary}`;

  notifier.notifyRenderer('agent:reply-ready', {
    agentId: record.agentId,
    spaceId: record.spaceId,
    threadId: ctx.threadId,
    body: replyBody,
  });
}
