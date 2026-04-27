/**
 * Typed IPC contract — the single source of truth for every IPC channel,
 * its argument types, and its return type.
 *
 * This file is **types only** — no runtime code.
 */

import type { Intent, CreateIntentInput, Attachment, AgentAnchor, AgentSession, LinkPreviewMeta, RecurrenceResult, RecallMatch, Skill, SkillContent, CanvasTarget } from './types';
import type { ChatEvent, ElicitationSchema, ElicitationFieldValue } from './chat-types';
import type { SubagentSummary, SubagentInfo } from './subagent-types';

// ---------------------------------------------------------------------------
// Helper types needed by the contract that don't exist in shared/ yet
// ---------------------------------------------------------------------------

export type IntentUpdates = Partial<
  Pick<Intent, 'description' | 'body' | 'client' | 'due_at' | 'due_at_utc' | 'status' | 'attachments'>
>;

export interface IntentEvent {
  id: string;
  intent_id: string;
  event_type: string;
  due_at: string | null;
  due_at_utc: string | null;
  completed_at: string | null;
  recurrence_json: string | null;
  created_at: string;
  intent_description: string | null;
  intent_client: string | null;
  session_id: string | null;
}

export interface AgentListItem {
  agentId: string;
  sessionId: string;
  status: 'running' | 'waiting-approval' | 'completed' | 'failed';
  summary: string;
  selectedText: string;
  anchor: AgentAnchor;
}

export interface AgentListAllItem extends AgentListItem {
  intentId: string;
  createdAt: string;
  pendingApprovalId: string | null;
  pendingPermissionKind: string | null;
  pendingIntention: string | null;
  pendingPath: string | null;
  source: 'sdk' | 'cli' | 'cloud';
}

export interface CanvasCommit {
  sha: string;
  message: string;
  date: string;
}

// Types currently only in src/main/config.ts — duplicated here so both
// main and renderer can reference them.  A later phase will unify.

export interface AgentPersona {
  id: string;
  handle: string;
  instructions: string;
  model: string;
  runLocation: 'local' | 'cloud';
}

export interface CliToolDefinition {
  name: string;
  description: string;
}

export interface CustomMcpServer {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  tools: string[];
}

export interface DiscoveredMcpServer {
  name: string;
  source: 'config' | 'plugin';
  type: string;
  command?: string;
  url?: string;
}

export interface CloudJobResult {
  jobId: string;
  sessionId: string;
  actor: { id: string; login: string };
  createdAt: string;
  updatedAt: string;
}

export interface CloudJobPollResult {
  jobId: string;
  sessionId: string;
  problemStatement: string;
  status: string;
  result?: string;
  actor: { id: string; login: string };
  createdAt: string;
  updatedAt: string;
  pullRequest?: { id: string; number: number; url?: string };
  workflowRun?: { id: string };
  error?: { message: string };
}

// ---------------------------------------------------------------------------
// 1. Commands — ipcMain.handle / ipcRenderer.invoke
// ---------------------------------------------------------------------------

export interface IpcCommands {
  // ── Intents ──────────────────────────────────────────────
  'intent:create': { args: [input: CreateIntentInput]; result: Intent };
  'intent:list': { args: []; result: Intent[] };
  'intent:update': { args: [id: string, updates: IntentUpdates]; result: Intent | null };
  'intent:delete': { args: [id: string]; result: boolean };
  'intent:dismiss-recurrence': { args: [id: string]; result: boolean };
  'intent:events': { args: [limit?: number]; result: IntentEvent[] };
  'intent:resolve-date': { args: [dateText: string]; result: { date: string; utc: string } | null };
  'intent:classify': { args: [text: string]; result: { type: 'intent' | 'query'; answer?: string } };
  'intent:summarize-title': { args: [canvasContent: string]; result: { title: string | null } };
  'intent:search': { args: [query: string]; result: Intent[] };
  'intent:unarchive': { args: [id: string]; result: Intent | null };

  // ── Voice ────────────────────────────────────────────────
  'voice:transcribe': { args: [audioData: number[]]; result: string };

  // ── Settings ─────────────────────────────────────────────
  'settings:get': { args: [key: string]; result: unknown };
  'settings:set': { args: [key: string, value: string]; result: void };

  // ── CLI / Models ─────────────────────────────────────────
  'cli:resolve-path': { args: []; result: string | null };
  'cli:check-version': { args: []; result: { path: string | null; version: string | null; compatible: boolean; minVersion: string } };
  'models:list': { args: []; result: Array<{ id: string; name: string }> };

  // ── Personas ─────────────────────────────────────────────
  'personas:list': { args: []; result: AgentPersona[] };
  'personas:save': { args: [personas: AgentPersona[]]; result: { ok: true } | { error: string } };

  // ── MCP servers ──────────────────────────────────────────
  'mcp:list-discovered': { args: []; result: DiscoveredMcpServer[] };
  'mcp:list-custom': { args: []; result: CustomMcpServer[] };
  'mcp:save-custom': { args: [servers: CustomMcpServer[]]; result: { ok: true } | { error: string } };

  // ── CLI tools ────────────────────────────────────────────
  'cli-tools:list': { args: []; result: CliToolDefinition[] };
  'cli-tools:save': { args: [tools: CliToolDefinition[]]; result: { ok: true } | { error: string } };

  // ── Sessions ─────────────────────────────────────────────
  'session:launch': { args: [intentId: string]; result: { success: boolean; error?: string } };
  'session:active-intents': { args: []; result: string[] };

  // ── Workspace / Shell ────────────────────────────────────
  'workspace:select': { args: []; result: { selected: boolean; path: string | null } };
  'workspace:clear': { args: []; result: { ok: true } };
  'shell:openPath': { args: [folderPath: string]; result: string };

  // ── Canvas ───────────────────────────────────────────────
  'canvas:read': { args: [intentId: string]; result: { content: string; error?: string } };
  'canvas:write': { args: [intentId: string, content: string]; result: { success?: boolean; error?: string } };
  'canvas:close': { args: [intentId: string, content: string]; result: void };
  'canvas:paste-file': { args: [intentId: string, filename: string, dataArray: number[]]; result: { path: string } | { error: string } };
  'canvas:resolve-attachment': { args: [intentId: string, relativePath: string]; result: { path: string; mimeType: string } | { error: string } };
  'canvas:fetch-link-meta': { args: [url: string]; result: LinkPreviewMeta };
  'canvas:history': { args: [intentId: string]; result: { commits: CanvasCommit[]; error?: string } };
  'canvas:restore': { args: [intentId: string, sha: string]; result: { success: boolean; error?: string } };

  // ── Agent ────────────────────────────────────────────────
  'agent:launch': {
    args: [intentId: string, selectedText: string, anchor: AgentAnchor, options?: { repo?: string; model?: string }];
    result: { agentId: string; sessionId: string } | { error: string };
  };
  'agent:launch-from-comment': {
    args: [intentId: string, commentBody: string, quotedText: string, anchor: AgentAnchor, personaHandle: string, threadIndex: number];
    result: { agentId: string; sessionId: string } | { error: string };
  };
  'agent:list': { args: [intentId: string]; result: AgentListItem[] };
  'agent:approve': { args: [agentId: string, requestId: string, approved: boolean]; result: void };
  'agent:respond-user-input': { args: [agentId: string, requestId: string, answer: string, wasFreeform: boolean]; result: void };
  'agent:respond-elicitation': {
    args: [agentId: string, requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>];
    result: void;
  };
  'agent:abort': { args: [agentId: string]; result: void };
  'agent:open-cli': { args: [agentId: string]; result: { error?: string } };
  'agent:quick-launch': { args: [prompt: string]; result: { agentId: string; sessionId: string } | { error: string } };
  'agent:list-all': { args: []; result: AgentListAllItem[] };
  'agent:delete-session': { args: [agentId: string]; result: { ok: true } };
  'agent:launch-cloud': {
    args: [intentId: string, prompt: string];
    result: { agentId: string; sessionId: string; jobId: string } | { error: string };
  };
  'agent:cloud-status': { args: [agentId: string]; result: CloudJobPollResult };
  'agent:get-history': { args: [agentId: string]; result: { events: unknown[]; restarted?: boolean } | { error: string } };

  // ── CLI session ──────────────────────────────────────────
  'cli:launch-session': { args: []; result: { agentId: string; sessionId: string } | { error: string } };

  // ── Chat ─────────────────────────────────────────────────
  'chat:send-message': {
    args: [agentId: string, prompt: string, attachments?: Array<{ type: 'file'; path: string }>];
    result: { error?: string; restarted?: boolean };
  };
  'chat:set-model': { args: [agentId: string, model: string]; result: { error?: string } };

  // ── Sub-agents ───────────────────────────────────────────
  'subagent:list': { args: [parentAgentId: string]; result: SubagentSummary[] };
  'subagent:read': { args: [parentAgentId: string, agentId: string]; result: SubagentInfo | null };
  'subagent:write': { args: [parentAgentId: string, agentId: string, message: string]; result: { success: boolean; error?: string } };
  'subagent:cancel': { args: [parentAgentId: string, agentId: string]; result: { success: boolean; error?: string } };

  // ── Window ───────────────────────────────────────────────
  'window:get-pinned': { args: []; result: boolean };

  // ── Skills ──────────────────────────────────────────────
  'skill:list': { args: []; result: Skill[] };
  'skill:read': { args: [skillId: string]; result: SkillContent | { error: string } };
  'skill:write': { args: [skillId: string, frontmatter: Record<string, unknown>, body: string]; result: { success: boolean } | { error: string } };
  'skill:create': { args: [name: string]; result: Skill | { error: string } };
  'skill:create-from-prompt': { args: [description: string]; result: { agentId: string; sessionId: string } | { error: string } };
  'skill:delete': { args: [skillId: string]; result: boolean };
  'skill:open-folder': { args: [skillId: string]; result: void };
  'skill:create-intent': { args: [skillId: string]; result: Intent | { error: string } };
  'skill:launch': { args: [skillId: string]; result: Intent | { error: string } };
}

// ---------------------------------------------------------------------------
// 2. Fire-and-forget messages — ipcRenderer.send / ipcMain.on
// ---------------------------------------------------------------------------

export interface IpcMessages {
  'window:hide': { args: [] };
  'window:expand': { args: [] };
  'window:collapse': { args: [] };
  'window:set-pinned': { args: [pinned: boolean] };
  'canvas-window:open': { args: [target: CanvasTarget] };
  'canvas-window:theme-changed': { args: [theme: string] };
}

// ---------------------------------------------------------------------------
// 3. Events — main → renderer via webContents.send
// ---------------------------------------------------------------------------

export interface IpcEvents {
  'chat:event': { agentId: string } & ChatEvent;
  'subagent:changed': { parentAgentId: string };
  'window:pinned-changed': { pinned: boolean };
  'canvas-window:load-target': CanvasTarget;
  'canvas-window:closed': void;
  'canvas-window:theme-changed': { theme: string };
  'window:shown': void;
  'window:toggle': void;
  'workspace:committed': void;
  'workspace:changed': { path: string | null };
  'agent:status-changed': { agentId: string; status: string; summary?: string };
  'agent:approval-needed': { agentId: string; requestId: string; permissionKind: string; intention?: string; path?: string };
  'agent:completed': { agentId: string; summary: string };
  'notification:approval-clicked': { agentId: string };
  'agent:presence-started': { agentId: string; intentId: string; persona: { name: string; handle: string }; anchor: AgentAnchor };
  'agent:presence-ended': { agentId: string; intentId: string };
  'agent:reply-ready': { agentId: string; intentId: string; threadIndex: number; body: string };
  'intent:processed': { intentId: string };
  'intent:recurrence': { intentId: string; result: RecurrenceResult };
  'intent:recurrence-applied': { intentId: string };
  'intent:recall': { intentId: string; match: RecallMatch };
  'skills:changed': void;
}

// ---------------------------------------------------------------------------
// Utility types — will be consumed by typed preload / handler wrappers
// ---------------------------------------------------------------------------

/** Extract the channel names for each category */
export type IpcCommandChannel = keyof IpcCommands;
export type IpcMessageChannel = keyof IpcMessages;
export type IpcEventChannel = keyof IpcEvents;

/** Extract args tuple for a command */
export type IpcCommandArgs<C extends IpcCommandChannel> = IpcCommands[C]['args'];

/** Extract return type for a command */
export type IpcCommandResult<C extends IpcCommandChannel> = IpcCommands[C]['result'];

/** Extract args tuple for a fire-and-forget message */
export type IpcMessageArgs<C extends IpcMessageChannel> = IpcMessages[C]['args'];

/** Extract payload for a main→renderer event */
export type IpcEventPayload<C extends IpcEventChannel> = IpcEvents[C];
