import { v4 as uuid } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { getCopilotClient, buildSandboxConfigs } from '../ai';
import { type AgentPersona, resolveSandboxPolicy } from '../config';
import { getAllMcpServers } from '../mcp';
import { updateCanvasContent } from '../database';
import { AgentRegistry } from './agent-registry';
import type { AgentRecord } from './agent-registry';
import { AgentNotifier } from './agent-notifier';
import { AgentPersistence } from './agent-persistence';
import { InteractionBroker } from './interaction-broker';
import { buildCliToolsPrompt } from './sdk-runner';
import { getCustomTools } from '../tools';
import {
  IS_WINDOWS,
  SANDBOX_SYSTEM_PROMPT,
  resolvePathPolicy,
  createSandboxPathPolicyHook,
  createSandboxShellDenialHook,
} from './sandbox-policies';

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
  intentId: string,
  commentBody: string,
  quotedText: string,
  anchor: { prefix?: string; suffix?: string },
  persona: AgentPersona,
  threadIndex: number,
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
    const allMcpServers = getAllMcpServers();
    const cliToolsPrompt = buildCliToolsPrompt();
    const findRecord = (sid: string) => registry.findBySessionId(sid);

    const isSandboxed = persona.sandboxed === true && IS_WINDOWS;

    // Resolve the persona's effective sandbox policy (override or default).
    const policy = isSandboxed ? resolveSandboxPolicy(persona) : null;
    const sandboxConfigs = isSandboxed ? buildSandboxConfigs(agentId, workingDir, policy!) : null;

    // Filter tool surface for sandboxed personas:
    //  - mcpServers: drop entirely if policy disallows MCP
    //  - custom tools: drop web_fetch if policy disallows it
    const mcpServers = isSandboxed && !policy!.allowMcpServers ? {} : allMcpServers;
    const allCustomTools = getCustomTools();
    const customTools = isSandboxed && !policy!.allowWebFetch
      ? allCustomTools.filter((t: any) => t?.name !== 'web_fetch' && t?.name !== 'web-fetch')
      : allCustomTools;

    // Build the sandbox runtime state to attach to the agent record so the
    // bubble-up handler can consult per-agent allow lists.
    const sandboxState = isSandboxed
      ? {
          policy: resolvePathPolicy(workingDir, policy!),
          configs: sandboxConfigs!,
          state: 'on' as const,
          allowMcpServers: policy!.allowMcpServers,
          allowWebFetch: policy!.allowWebFetch,
          allowList: { paths: new Set<string>(), resources: new Set<string>(), webFetch: false },
        }
      : undefined;

    const systemPrompt = `${persona.instructions}

You are responding to a comment on a canvas document. The user wrote:

Comment: "${commentBody}"
On this text: "${quotedText}"

The full canvas document is available as canvas.md in the working directory.
If you make changes to the document, clearly describe what you changed.${cliToolsPrompt}`;

    // Build hooks for sandboxed personas.
    let hooks: Record<string, unknown> | undefined;
    if (isSandboxed && sandboxState) {
      const onBlock = async (info: { toolName: string; kind: 'read' | 'write' | 'web-fetch' | 'shell'; target: string; requiresWrite: boolean }) => {
        const livingRecord = registry.get(agentId);
        if (!livingRecord) return { permissionDecision: 'deny' as const };
        const resolution = await broker.emitSandboxBlock(livingRecord, {
          source: 'pre-tool',
          kind: info.kind,
          toolName: info.toolName,
          target: info.target,
          allowedDecisions: info.kind === 'shell' ? ['allow-once', 'disable'] : ['allow-once', 'allow-for-session', 'disable'],
        });
        if (resolution.decision === 'allow-once' || resolution.decision === 'disable') {
          return { permissionDecision: 'allow' as const };
        }
        if (resolution.decision === 'allow-for-session' && livingRecord.sandbox) {
          if (info.kind === 'web-fetch') {
            livingRecord.sandbox.allowList.webFetch = true;
          } else {
            const { normalizePath } = await import('./sandbox-policies');
            livingRecord.sandbox.allowList.paths.add(normalizePath(info.target));
          }
          return { permissionDecision: 'allow' as const };
        }
        return { permissionDecision: 'deny' as const };
      };

      hooks = {
        onPreToolUse: createSandboxPathPolicyHook({
          policy: sandboxState.policy,
          allowWebFetch: policy!.allowWebFetch,
          isDisabled: () => registry.get(agentId)?.sandbox?.state === 'off',
          allowList: () => registry.get(agentId)?.sandbox?.allowList ?? sandboxState.allowList,
          onBlock,
        }),
        onPostToolUse: createSandboxShellDenialHook({
          isDisabled: () => registry.get(agentId)?.sandbox?.state === 'off',
          onBlock: async (info) => {
            const livingRecord = registry.get(agentId);
            if (!livingRecord) return;
            await broker.emitSandboxBlock(livingRecord, {
              source: 'post-tool-shell',
              kind: 'shell',
              toolName: info.toolName,
              target: info.target,
              intention: `Possible MXC denial detected: "${info.matchedPattern}"`,
              allowedDecisions: ['allow-once', 'disable'],
            });
          },
        }),
      };
    }

    const session = await client.createSession({
      workingDirectory: workingDir,
      ...(sandboxConfigs ? { configDir: sandboxConfigs.onDir } : {}),
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      tools: customTools,
      ...(persona.model ? { model: persona.model } : {}),
      ...(hooks ? { hooks } : {}),
      onPermissionRequest: isSandboxed
        ? broker.createPathAwareSandboxPermissionHandler(findRecord)
        : broker.createPermissionHandler(findRecord),
      onUserInputRequest: broker.createUserInputHandler(findRecord),
      onElicitationRequest: broker.createElicitationHandler(findRecord),
      systemMessage: {
        mode: 'append',
        content: isSandboxed
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
      intentId,
      selectedText: commentBody,
      anchor: { quote: quotedText, prefix: anchor.prefix || '', suffix: anchor.suffix || '' },
      status: 'running',
      pendingApprovalId: null,
      pendingPermissionKind: null,
      pendingApprovals: new Map(),
      summary: 'Starting...',
      ...(sandboxState ? { sandbox: sandboxState } : {}),
      commentContext: {
        threadIndex,
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

    persistence.createAgentSessionRecord({
      id: agentId,
      session_id: sessionId,
      intent_id: intentId,
      prompt: commentBody,
      status: 'running',
      summary: 'Starting...',
      working_dir: workingDir,
      source: 'sdk',
      persona_handle: persona.handle,
      created_at: now,
      updated_at: now,
    });

    setupListeners(session, record);

    // Notify renderer to show presence
    notifier.notifyRenderer('agent:presence-started', {
      agentId,
      intentId,
      persona: { name: persona.handle, handle: persona.handle },
      anchor,
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
        notifier.notifyRenderer('agent:presence-ended', { agentId, intentId: record.intentId });
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
    intentId: record.intentId,
  });

  // Detect if agent modified canvas.md
  let documentChanged = false;
  let newContent = '';
  try {
    newContent = fs.readFileSync(ctx.canvasPath, 'utf-8');
    const currentHash = crypto.createHash('md5').update(newContent).digest('hex');
    documentChanged = ctx.canvasHashBefore !== '' && currentHash !== ctx.canvasHashBefore;
  } catch { /* non-fatal */ }

  // If the document changed, sync DB and push live update to renderer
  if (documentChanged) {
    updateCanvasContent(record.intentId, newContent);
    notifier.notifyRenderer('canvas:content-updated', {
      intentId: record.intentId,
      content: newContent,
    });
  }

  // Send reply to renderer
  const replyBody = documentChanged
    ? `[bot] I've made changes to the document. Ready for your review.`
    : `[bot] ${record.summary}`;

  notifier.notifyRenderer('agent:reply-ready', {
    agentId: record.agentId,
    intentId: record.intentId,
    threadIndex: ctx.threadIndex,
    body: replyBody,
  });
}
