// Chat message types for the in-app agent chat experience.
// Inspired by github-tokens' ConversationMessage model.

export type ChatMessage =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | ReasoningMessage
  | ApprovalMessage
  | UserInputMessage
  | ElicitationMessage
  | SessionEventMessage;

export interface UserMessage {
  id: string;
  type: 'user';
  content: string;
  attachments?: ChatAttachment[];
  timestamp: string;
}

export interface AssistantMessage {
  id: string;
  type: 'assistant';
  content: string;
  isStreaming: boolean;
  timestamp: string;
}

export interface ToolCallMessage {
  id: string;
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  completed: boolean;
  success?: boolean;
  timestamp: string;
}

export interface ReasoningMessage {
  id: string;
  type: 'reasoning';
  reasoningId: string;
  content: string;
  isStreaming: boolean;
  timestamp: string;
}

export interface ApprovalMessage {
  id: string;
  type: 'approval';
  requestId: string;
  agentId: string;
  permissionKind: string;
  intention?: string;
  path?: string;
  responded: boolean;
  approved?: boolean;
  timestamp: string;
}

export interface SessionEventMessage {
  id: string;
  type: 'session_event';
  eventType: 'idle' | 'error' | 'completed' | 'started';
  message?: string;
  timestamp: string;
}

export interface UserInputMessage {
  id: string;
  type: 'user_input';
  requestId: string;
  agentId: string;
  question: string;
  choices?: string[];
  allowFreeform?: boolean;
  responded: boolean;
  answer?: string;
  wasFreeform?: boolean;
  timestamp: string;
}

// Re-export SDK elicitation schema types for convenience
export type ElicitationSchemaField = import('@github/copilot-sdk').ElicitationSchemaField;
export type ElicitationSchema = import('@github/copilot-sdk').ElicitationSchema;
export type ElicitationFieldValue = import('@github/copilot-sdk').ElicitationFieldValue;

export interface ElicitationMessage {
  id: string;
  type: 'elicitation';
  requestId: string;
  agentId: string;
  message: string;
  requestedSchema?: ElicitationSchema;
  mode?: 'form' | 'url';
  elicitationSource?: string;
  responded: boolean;
  action?: 'accept' | 'decline' | 'cancel';
  content?: Record<string, ElicitationFieldValue>;
  timestamp: string;
}

export interface ChatAttachment {
  type: 'file';
  name: string;
  path: string;
  mimeType?: string;
}

// Events sent from main process to renderer via IPC
export type ChatEvent =
  | { type: 'assistant.message_delta'; delta: string }
  | { type: 'assistant.message'; content: string }
  | { type: 'assistant.reasoning_delta'; reasoningId: string; delta: string }
  | { type: 'assistant.reasoning'; reasoningId: string; content: string }
  | { type: 'tool.start'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool.progress'; toolCallId: string; message: string }
  | { type: 'tool.complete'; toolCallId: string; result: string; success: boolean }
  | { type: 'session.idle' }
  | { type: 'session.error'; message: string }
  | { type: 'approval.needed'; requestId: string; agentId: string; permissionKind: string; intention?: string; path?: string }
  | { type: 'approval.resolved'; requestId: string; approved: boolean }
  | { type: 'user_input.requested'; requestId: string; agentId: string; question: string; choices?: string[]; allowFreeform?: boolean }
  | { type: 'user_input.resolved'; requestId: string; answer: string; wasFreeform: boolean }
  | { type: 'elicitation.requested'; requestId: string; agentId: string; message: string; requestedSchema?: ElicitationSchema; mode?: 'form' | 'url'; elicitationSource?: string }
  | { type: 'elicitation.resolved'; requestId: string; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, ElicitationFieldValue> }
  | { type: 'subagent.started'; toolCallId: string; name: string; displayName: string; description: string; agentId?: string }
  | { type: 'subagent.completed'; toolCallId: string; name: string; agentId?: string; durationMs?: number; model?: string; totalTokens?: number; totalToolCalls?: number }
  | { type: 'subagent.failed'; toolCallId: string; name: string; error: string; agentId?: string };
