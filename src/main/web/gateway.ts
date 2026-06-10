import type { IpcCommandChannel } from '../../shared/ipc-contract';
import type { CreateSpaceInput, Space } from '../../shared/types';
import {
  createSpace,
  deleteAgentSession,
  getSpace,
  isInitialized,
  listSpaceEvents,
  listSpaces,
  searchSpaces,
} from '../database';
import { classifyInput, listAvailableModels, resolveDateWithAI } from '../ai';
import { getConfigValue, DEFAULT_PERSONAS, type AgentPersona } from '../config';
import { materializeSpaceCanvas, scheduleAutoCommit } from '../workspace';
import { processSpaceInBackground } from '../services/space-processing';
import { notifyAllWindows } from '../notify';

export const WEB_REMOTE_COMMAND_ALLOWLIST = [
  'space:create',
  'space:classify',
  'space:resolve-date',
  'space:list',
  'space:search',
  'space:events',
  'agent:list-all',
  'agent:get-history',
  'agent:abort',
  'agent:delete-session',
  'chat:send-message',
  'agent:approve',
  'agent:respond-user-input',
  'agent:respond-elicitation',
  'agent:quick-launch',
  'agent:launch-cloud',
  'personas:list',
  'models:list',
] as const satisfies readonly IpcCommandChannel[];

export type WebRemoteCommandChannel = typeof WEB_REMOTE_COMMAND_ALLOWLIST[number];

const ALLOWLIST = new Set<string>(WEB_REMOTE_COMMAND_ALLOWLIST);

export class GatewayError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

type Handler = (args: unknown[]) => Promise<unknown> | unknown;

const HANDLERS: Record<WebRemoteCommandChannel, Handler> = {
  'space:create': createSpaceFromArgs,
  'space:classify': classifySpaceFromArgs,
  'space:resolve-date': resolveDateFromArgs,
  'space:list': () => isInitialized() ? listSpaces() : [],
  'space:search': (args) => isInitialized() ? searchSpaces(expectString(args, 0, 'query')) : [],
  'space:events': (args) => listSpaceEvents(expectOptionalNumber(args, 0, 'limit') ?? 100),
  'agent:list-all': async () => {
    const { listAllAgents } = await import('../agent-service');
    return listAllAgents();
  },
  'agent:get-history': async (args) => {
    const { getAgentHistory } = await import('../agent-service');
    return getAgentHistory(expectString(args, 0, 'agentId'));
  },
  'agent:abort': async (args) => {
    const { abortAgent } = await import('../agent-service');
    await abortAgent(expectString(args, 0, 'agentId'));
  },
  'agent:delete-session': async (args) => {
    const { abortAgent, forgetAgent } = await import('../agent-service');
    const agentId = expectString(args, 0, 'agentId');
    try { await abortAgent(agentId); } catch { /* already stopped */ }
    deleteAgentSession(agentId);
    forgetAgent(agentId);
    return { ok: true };
  },
  'chat:send-message': async (args) => {
    const { sendChatMessage } = await import('../agent-service');
    return sendChatMessage(
      expectString(args, 0, 'agentId'),
      expectString(args, 1, 'prompt'),
      expectOptionalAttachments(args[2]),
    );
  },
  'agent:approve': async (args) => {
    const { approveAgent } = await import('../agent-service');
    approveAgent(
      expectString(args, 0, 'agentId'),
      expectString(args, 1, 'requestId'),
      expectBoolean(args, 2, 'approved'),
    );
  },
  'agent:respond-user-input': async (args) => {
    const { respondToUserInput } = await import('../agent-service');
    respondToUserInput(
      expectString(args, 0, 'agentId'),
      expectString(args, 1, 'requestId'),
      expectString(args, 2, 'answer'),
      expectBoolean(args, 3, 'wasFreeform'),
    );
  },
  'agent:respond-elicitation': async (args) => {
    const action = expectString(args, 2, 'action');
    if (action !== 'accept' && action !== 'decline' && action !== 'cancel') {
      throw invalidArg('action must be accept, decline, or cancel');
    }
    const { respondToElicitation } = await import('../agent-service');
    respondToElicitation(
      expectString(args, 0, 'agentId'),
      expectString(args, 1, 'requestId'),
      action,
      expectOptionalRecord(args[3]),
    );
  },
  'agent:quick-launch': quickLaunchFromArgs,
  'agent:launch-cloud': launchCloudFromArgs,
  'personas:list': () => {
    const personas = (getConfigValue('personas') || []) as AgentPersona[];
    return personas.length > 0 ? personas : DEFAULT_PERSONAS;
  },
  'models:list': () => listAvailableModels(),
};

export function isAllowedWebRemoteCommand(channel: string): channel is WebRemoteCommandChannel {
  return ALLOWLIST.has(channel);
}

export async function invokeWebRemoteCommand(channel: string, args: unknown[]): Promise<unknown> {
  if (!isAllowedWebRemoteCommand(channel)) {
    throw new GatewayError('channel_not_allowed', 403, `Channel is not available over web remote: ${channel}`);
  }
  if (!Array.isArray(args)) {
    throw invalidArg('args must be an array');
  }

  const result = await HANDLERS[channel](args);
  return JSON.parse(JSON.stringify(result ?? null));
}

function createSpaceFromArgs(args: unknown[]): Space | { error: string } {
  if (!isInitialized()) return { error: 'no_workspace' };
  const input = expectRecord<CreateSpaceInput>(args[0], 'input');
  if (typeof input.body !== 'string' || !input.body.trim()) {
    throw invalidArg('input.body must be a non-empty string');
  }

  const space = createSpace({ body: input.body });
  const workspace = getConfigValue('workspace');
  if (workspace && space.folder) {
    const folder = space.folder;
    void materializeSpaceCanvas(workspace, folder, space.body)
      .then(() => scheduleAutoCommit(workspace))
      .catch((err) => console.error('[web-remote] Canvas materialization failed:', err));
  }

  processSpaceInBackground(space.id, space.body || space.description, space.updated_at);
  return space;
}

async function classifySpaceFromArgs(args: unknown[]): Promise<{ type: 'space' | 'query'; answer?: string }> {
  const text = expectString(args, 0, 'text');
  if (!isInitialized()) return { type: 'space' };
  const recent = listSpaces().map(i => ({
    description: i.description,
    status: i.status,
    due_at: i.due_at,
    completed_at: i.completed_at,
  }));
  return classifyInput(text, recent);
}

function resolveDateFromArgs(args: unknown[]): Promise<{ due_at: string; due_at_utc: string | null } | null> {
  return resolveDateWithAI(expectString(args, 0, 'dateText'));
}

async function quickLaunchFromArgs(args: unknown[]): Promise<unknown> {
  const prompt = expectString(args, 0, 'prompt');
  const personaHandle = expectOptionalString(args, 1, 'personaHandle');
  const workspace = getConfigValue('workspace');
  if (!workspace) return { error: 'no_workspace' };

  let persona: AgentPersona | undefined;
  if (personaHandle) {
    const allPersonas = ((getConfigValue('personas') as AgentPersona[]) || []);
    persona = allPersonas.find(p => p.handle === personaHandle);
    if (!persona) return { error: `Persona @${personaHandle} not found` };
  }

  if (persona?.runLocation === 'cca') {
    return launchCcaQuickAgent(prompt, workspace, persona);
  }

  const { launchQuickAgent } = await import('../agent-service');
  return launchQuickAgent(prompt, workspace, persona);
}

async function launchCloudFromArgs(args: unknown[]): Promise<unknown> {
  const spaceId = expectString(args, 0, 'spaceId');
  const prompt = expectString(args, 1, 'prompt');
  const workspace = getConfigValue('workspace');
  if (!workspace) return { error: 'no_workspace' };
  return launchCloudAgent(spaceId, prompt, workspace, null);
}

async function launchCcaQuickAgent(prompt: string, workspace: string, persona: AgentPersona): Promise<unknown> {
  const fullPrompt = `${persona.instructions}\n\n${prompt}`;
  return launchCloudAgent(null, fullPrompt, workspace, persona.handle);
}

async function launchCloudAgent(
  spaceId: string | null,
  prompt: string,
  workspace: string,
  personaHandle: string | null,
): Promise<unknown> {
  const { getWorkspaceRepo, getGitHubToken, launchCloudAgentWithFallback } = await import('../cloud-agent');
  const repoInfo = await getWorkspaceRepo(workspace);
  if (!repoInfo) return { error: 'Could not determine repository from workspace. Ensure a git remote is configured.' };

  const token = await getGitHubToken();
  if (!token) return { error: 'No GitHub token found. Run `gh auth login` or set GITHUB_TOKEN.' };

  const launch = await launchCloudAgentWithFallback(repoInfo.owner, repoInfo.repo, prompt, token);
  if ('error' in launch) return launch;
  const { result, fallback } = launch;

  const { v4: uuid } = await import('uuid');
  const agentId = uuid();
  const now = new Date().toISOString();
  const effective = fallback
    ? { owner: fallback.effectiveOwner, repo: fallback.effectiveRepo }
    : repoInfo;
  const summary = fallback
    ? `Cloud job ${result.jobId} on fork ${fallback.effectiveOwner}/${fallback.effectiveRepo} (upstream ${fallback.upstream.owner}/${fallback.upstream.repo} blocked by SSO)`
    : `Cloud job ${result.jobId}`;
  const { createAgentSession } = await import('../database');
  createAgentSession({
    id: agentId,
    session_id: result.sessionId,
    space_id: spaceId,
    prompt,
    status: 'running',
    summary,
    working_dir: workspace,
    source: 'cca' as any,
    persona_handle: personaHandle,
    quoted_text: null,
    run_location: 'cloud',
    created_at: now,
    updated_at: now,
  });

  const { startCloudJobPoller } = await import('../cloud-agent-poller');
  startCloudJobPoller(agentId, effective.owner, effective.repo, result.jobId, token);
  notifyAllWindows('agent:status-changed', { agentId, status: 'running', summary, fallback });

  return { agentId, sessionId: result.sessionId, jobId: result.jobId, fallback };
}

function invalidArg(message: string): GatewayError {
  return new GatewayError('invalid_args', 400, message);
}

function expectString(args: unknown[], index: number, name: string): string {
  const value = args[index];
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidArg(`${name} must be a non-empty string`);
  }
  return value;
}

function expectOptionalString(args: unknown[], index: number, name: string): string | undefined {
  const value = args[index];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw invalidArg(`${name} must be a string`);
  return value;
}

function expectBoolean(args: unknown[], index: number, name: string): boolean {
  const value = args[index];
  if (typeof value !== 'boolean') throw invalidArg(`${name} must be a boolean`);
  return value;
}

function expectOptionalNumber(args: unknown[], index: number, name: string): number | undefined {
  const value = args[index];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidArg(`${name} must be a number`);
  return value;
}

function expectRecord<T extends object = Record<string, unknown>>(value: unknown, name: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidArg(`${name} must be an object`);
  }
  return value as T;
}

function expectOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  return expectRecord<Record<string, unknown>>(value, 'content');
}

function expectOptionalAttachments(value: unknown): Array<{ type: 'file'; path: string }> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw invalidArg('attachments must be an array');
  return value.map((entry) => {
    const item = expectRecord<Record<string, unknown>>(entry, 'attachment');
    if (item.type !== 'file' || typeof item.path !== 'string' || !item.path.trim()) {
      throw invalidArg('attachments must contain file paths');
    }
    return { type: 'file' as const, path: item.path };
  });
}
