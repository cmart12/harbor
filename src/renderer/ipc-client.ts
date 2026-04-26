/**
 * Typed IPC client for the renderer process.
 *
 * Provides typed access to the preload-injected `window.intentAPI` bridge
 * and re-exports the types that renderer code commonly needs.
 *
 * Usage:
 *   import { getAPI } from './ipc-client';
 *   const api = getAPI();
 *   const intents = await api.list();
 */

// ── Core API interfaces from preload ────────────────────────────────────────
import type { IntentAPI, SubagentAPI } from '../main/preload';

export type { IntentAPI, SubagentAPI };

// ── IPC contract types ──────────────────────────────────────────────────────
export type {
  AgentPersona,
  CliToolDefinition,
  CustomMcpServer,
  DiscoveredMcpServer,
  AgentListItem,
  AgentListAllItem,
  IntentUpdates,
  IntentEvent,
  CanvasCommit,
  CloudJobPollResult,
  CloudJobResult,
  IpcEventPayload,
} from '../shared/ipc-contract';

// ── Domain types ────────────────────────────────────────────────────────────
export type {
  Intent,
  CreateIntentInput,
  AgentAnchor,
  AgentSession,
  LinkPreviewMeta,
  RecurrenceResult,
  RecallMatch,
  Attachment,
} from '../shared/types';

// ── Chat types ──────────────────────────────────────────────────────────────
export type {
  ChatEvent,
  ChatMessage,
  UserMessage,
  AssistantMessage,
  ToolCallMessage,
  ReasoningMessage,
  ApprovalMessage,
  UserInputMessage,
  ElicitationMessage,
  SessionEventMessage,
  ChatAttachment,
} from '../shared/chat-types';

// ── Sub-agent types ─────────────────────────────────────────────────────────
export type {
  SubagentSummary,
  SubagentInfo,
  SubagentStatus,
  SubagentType,
  SubagentTurn,
  SubagentToolCall,
  SubagentProgress,
} from '../shared/subagent-types';

/**
 * Typed accessor for the preload-injected IPC bridge.
 * Use this instead of accessing `window.intentAPI` directly.
 */
export function getAPI(): IntentAPI {
  return (window as any).intentAPI;
}
