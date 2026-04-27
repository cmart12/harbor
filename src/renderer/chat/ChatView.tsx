import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage, ChatEvent, ChatAttachment, AssistantMessage as AssistantMsgType, ToolCallMessage, ReasoningMessage, ApprovalMessage, UserInputMessage, ElicitationMessage, SessionEventMessage } from '../../shared/chat-types';
import { MessageList } from './MessageList';
import { PromptBar } from './PromptBar';
import { SubagentDetailOverlay } from './SubagentDetailOverlay';

declare const intentAPI: {
  sendChatMessage: (agentId: string, prompt: string, attachments?: any[]) => Promise<{ error?: string }>;
  onChatEvent: (agentId: string, callback: (event: ChatEvent) => void) => () => void;
  approveAgent: (agentId: string, requestId: string, approved: boolean) => Promise<void>;
  respondToUserInput: (agentId: string, requestId: string, answer: string, wasFreeform: boolean) => Promise<void>;
  respondToElicitation: (agentId: string, requestId: string, action: string, content?: Record<string, unknown>) => Promise<void>;
  openAgentCli: (agentId: string) => Promise<any>;
  abortAgent: (agentId: string) => Promise<void>;
  listModels: () => Promise<{ id: string; name?: string }[]>;
  getSetting: (key: string) => Promise<string | null>;
  setChatModel: (agentId: string, model: string) => Promise<{ error?: string }>;
  quickLaunchAgent: (prompt: string) => Promise<{ agentId: string; sessionId: string } | { error: string }>;
  getAgentHistory: (agentId: string) => Promise<{ events?: any[]; error?: string }>;
  selectWorkspace: () => Promise<{ selected: boolean; path: string | null }>;
  onWorkspaceChanged: (callback: (path: string | null) => void) => void;
  [key: string]: any;
};

interface ChatViewProps {
  agentId?: string;
  agentPrompt: string;
  agentStatus: string;
  agentSource?: 'sdk' | 'cli';
  pendingApprovalId?: string;
  pendingPermissionKind?: string;
  onClose: () => void;
  onOpenCli: (agentId: string) => void;
}

let nextMsgId = 1;
function genId(): string {
  return `msg-${nextMsgId++}`;
}

/** Transform SDK SessionEvent[] into ChatMessage[] for display. */
function parseHistoryEvents(events: any[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  // Track tool calls by ID so we can update them with completion data
  const toolMsgMap = new Map<string, number>();
  // Track approval messages by requestId for permission.completed matching
  const approvalMsgMap = new Map<string, number>();

  for (const event of events) {
    const type = event.type || event.kind;
    const data = event.data || event;
    const ts = event.timestamp || new Date().toISOString();

    if (type === 'user.message' || type === 'user_message') {
      const content = data.content || data.prompt || data.message || '';
      if (content) {
        messages.push({ id: genId(), type: 'user', content, timestamp: ts });
      }
    } else if (type === 'assistant.message' || type === 'assistant_message') {
      const content = data.content || data.message || '';
      if (content) {
        messages.push({ id: genId(), type: 'assistant', content, isStreaming: false, timestamp: ts } as AssistantMsgType);
      }
    } else if (type === 'assistant.reasoning' || type === 'assistant_reasoning') {
      const content = data.content || '';
      if (content) {
        messages.push({
          id: genId(), type: 'reasoning',
          reasoningId: data.reasoningId || '', content, isStreaming: false, timestamp: ts,
        } as ReasoningMessage);
      }
    } else if (type === 'tool.execution_start' || type === 'tool_execution_start') {
      const toolCallId = data.toolCallId || '';
      const msg: ToolCallMessage = {
        id: genId(), type: 'tool_call', toolCallId,
        toolName: data.toolName || 'tool', args: data.arguments || data.toolArgs || {},
        completed: false, timestamp: ts,
      };
      toolMsgMap.set(toolCallId, messages.length);
      messages.push(msg);
    } else if (type === 'tool.execution_complete' || type === 'tool_execution_complete') {
      const toolCallId = data.toolCallId || '';
      const idx = toolMsgMap.get(toolCallId);
      if (idx !== undefined && messages[idx]?.type === 'tool_call') {
        const msg = messages[idx] as ToolCallMessage;
        msg.completed = true;
        // SDK result may be { content, detailedContent? } or a plain string
        const rawResult = data.result;
        msg.result = typeof rawResult === 'string'
          ? rawResult
          : rawResult?.detailedContent ?? rawResult?.content ?? '';
        msg.success = data.success !== false;
      }
    } else if (type === 'session.error' || type === 'session_error') {
      messages.push({
        id: genId(), type: 'session_event', eventType: 'error',
        message: data.message || 'Unknown error', timestamp: ts,
      } as SessionEventMessage);
    } else if (type === 'elicitation.requested') {
      messages.push({
        id: genId(), type: 'elicitation',
        requestId: data.requestId || '',
        agentId: data.agentId || '',
        message: data.message || '',
        requestedSchema: data.requestedSchema,
        mode: data.mode,
        elicitationSource: data.elicitationSource,
        responded: false,
        timestamp: ts,
      } as ElicitationMessage);
    } else if (type === 'elicitation.completed') {
      // Find the matching elicitation message and mark it resolved
      const elicitIdx = messages.findIndex(
        m => m.type === 'elicitation' && m.requestId === (data.requestId || '') && !m.responded
      );
      if (elicitIdx !== -1) {
        const msg = messages[elicitIdx] as ElicitationMessage;
        msg.responded = true;
        msg.action = data.action;
        msg.content = data.content;
      }
    } else if (type === 'permission.requested') {
      // SDK persists permission requests — map to ApprovalMessage
      const pr = data.permissionRequest || data;
      const reqId = pr.toolCallId || data.requestId || '';
      const approvalMsg: ApprovalMessage = {
        id: genId(), type: 'approval',
        requestId: reqId,
        agentId: '',
        permissionKind: pr.kind || 'permission',
        intention: pr.intention,
        path: pr.path || pr.fileName,
        responded: false,
        timestamp: ts,
      };
      approvalMsgMap.set(reqId, messages.length);
      messages.push(approvalMsg);
    } else if (type === 'permission.completed') {
      const reqId = data.requestId || '';
      const approved = data.result?.kind === 'approved' || data.result?.kind === 'approve-once' || data.result?.kind === 'approve-for-session' || data.result?.kind === 'approve-for-location';
      // Try to match by SDK requestId — approvalMsgMap stores by toolCallId,
      // but permission.completed uses SDK requestId. Scan for unresolved approvals.
      const idx = approvalMsgMap.get(reqId);
      if (idx !== undefined && messages[idx]?.type === 'approval') {
        const msg = messages[idx] as ApprovalMessage;
        msg.responded = true;
        msg.approved = approved;
      } else {
        // Fallback: find most recent unresolved approval
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].type === 'approval' && !(messages[i] as ApprovalMessage).responded) {
            (messages[i] as ApprovalMessage).responded = true;
            (messages[i] as ApprovalMessage).approved = approved;
            break;
          }
        }
      }
    }
  }
  return messages;
}

/**
 * Apply a buffered completion event (tool.complete, approval.resolved, session.idle/error)
 * to the message list using ID-based matching. This is idempotent.
 */
function applyCompletionEvent(msgs: ChatMessage[], event: ChatEvent): ChatMessage[] {
  switch (event.type) {
    case 'tool.complete':
      return msgs.map(m =>
        m.type === 'tool_call' && m.toolCallId === event.toolCallId
          ? { ...m, completed: true, success: event.success, result: event.result, error: event.error }
          : m
      );
    case 'approval.resolved':
      return msgs.map(m =>
        m.type === 'approval' && m.requestId === event.requestId
          ? { ...m, responded: true, approved: event.approved }
          : m
      );
    case 'user_input.resolved':
      return msgs.map(m =>
        m.type === 'user_input' && m.requestId === event.requestId
          ? { ...m, responded: true, answer: event.answer, wasFreeform: event.wasFreeform }
          : m
      );
    case 'elicitation.resolved':
      return msgs.map(m =>
        m.type === 'elicitation' && m.requestId === event.requestId
          ? { ...m, responded: true, action: event.action, content: event.content }
          : m
      );
    default:
      return msgs;
  }
}

/**
 * Replay buffered events that arrived during history loading.
 * Uses ID-based dedup to avoid duplicating messages already present from history.
 * Skips assistant deltas (unsafe to dedup) and tool.progress (not idempotent).
 */
function replayBufferedEvents(msgs: ChatMessage[], events: ChatEvent[]): ChatMessage[] {
  let result = [...msgs];

  // Build dedup sets from existing messages
  const existingToolCallIds = new Set<string>();
  const existingApprovalIds = new Set<string>();
  const existingUserInputIds = new Set<string>();
  const existingElicitationIds = new Set<string>();

  for (const m of result) {
    if (m.type === 'tool_call') existingToolCallIds.add((m as ToolCallMessage).toolCallId);
    else if (m.type === 'approval') existingApprovalIds.add((m as ApprovalMessage).requestId);
    else if (m.type === 'user_input') existingUserInputIds.add((m as UserInputMessage).requestId);
    else if (m.type === 'elicitation') existingElicitationIds.add((m as ElicitationMessage).requestId);
  }

  for (const event of events) {
    switch (event.type) {
      // Completion events — idempotent
      case 'tool.complete':
      case 'approval.resolved':
      case 'user_input.resolved':
      case 'elicitation.resolved':
        result = applyCompletionEvent(result, event);
        break;

      case 'tool.start':
        if (!existingToolCallIds.has(event.toolCallId)) {
          result.push({
            id: genId(), type: 'tool_call',
            toolCallId: event.toolCallId, toolName: event.toolName,
            args: event.args, completed: false,
            timestamp: new Date().toISOString(),
          } as ToolCallMessage);
          existingToolCallIds.add(event.toolCallId);
        }
        break;

      case 'approval.needed':
        if (!existingApprovalIds.has(event.requestId)) {
          result.push({
            id: genId(), type: 'approval',
            requestId: event.requestId, agentId: event.agentId,
            permissionKind: event.permissionKind,
            intention: event.intention, path: event.path,
            responded: false,
            timestamp: new Date().toISOString(),
          } as ApprovalMessage);
          existingApprovalIds.add(event.requestId);
        }
        break;

      case 'user_input.requested':
        if (!existingUserInputIds.has(event.requestId)) {
          result.push({
            id: genId(), type: 'user_input',
            requestId: event.requestId, agentId: event.agentId,
            question: event.question, choices: event.choices,
            allowFreeform: event.allowFreeform, responded: false,
            timestamp: new Date().toISOString(),
          } as UserInputMessage);
          existingUserInputIds.add(event.requestId);
        }
        break;

      case 'elicitation.requested':
        if (!existingElicitationIds.has(event.requestId)) {
          result.push({
            id: genId(), type: 'elicitation',
            requestId: event.requestId, agentId: event.agentId,
            message: event.message, requestedSchema: event.requestedSchema,
            mode: event.mode, elicitationSource: event.elicitationSource,
            responded: false,
            timestamp: new Date().toISOString(),
          } as ElicitationMessage);
          existingElicitationIds.add(event.requestId);
        }
        break;

      case 'session.error':
        result.push({
          id: genId(), type: 'session_event', eventType: 'error',
          message: event.message, timestamp: new Date().toISOString(),
        } as SessionEventMessage);
        break;

      case 'subagent.started':
        if (!existingToolCallIds.has(event.toolCallId)) {
          result.push({
            id: genId(), type: 'tool_call',
            toolCallId: event.toolCallId, toolName: '__subagent__',
            args: {
              name: event.name, displayName: event.displayName,
              description: event.description, agentType: event.name,
              agentId: event.agentId, completed: false,
            },
            completed: false, timestamp: new Date().toISOString(),
          } as ToolCallMessage);
          existingToolCallIds.add(event.toolCallId);
        }
        break;

      case 'subagent.completed':
        result = result.map(m =>
          m.type === 'tool_call' && m.toolCallId === event.toolCallId
            ? { ...m, completed: true, success: true, args: { ...m.args, completed: true, success: true, agentId: event.agentId ?? m.args.agentId, durationMs: event.durationMs, model: event.model, totalTokens: event.totalTokens, totalToolCalls: event.totalToolCalls } }
            : m
        );
        break;

      case 'subagent.failed':
        result = result.map(m =>
          m.type === 'tool_call' && m.toolCallId === event.toolCallId
            ? { ...m, completed: true, success: false, args: { ...m.args, completed: true, success: false, error: event.error, agentId: event.agentId ?? m.args.agentId } }
            : m
        );
        break;

      // Skip: assistant.message_delta, assistant.message, assistant.reasoning_delta,
      // assistant.reasoning, tool.progress, session.idle
      // Deltas are unsafe to dedup; progress is not idempotent;
      // session.idle is handled by the live handler after loading.
    }
  }

  return result;
}

export function ChatView({ agentId: initialAgentId, agentPrompt, agentStatus: initialStatus, agentSource, pendingApprovalId, pendingPermissionKind, onClose, onOpenCli }: ChatViewProps) {
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(initialAgentId || null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // For CLI sessions or sessions with history, don't seed — history will load
    if (initialAgentId && agentSource === 'cli') return [];
    // Seed with the initial agent prompt as the first "user" message
    const seed: ChatMessage[] = [];
    if (agentPrompt) {
      seed.push({
        id: genId(),
        type: 'user',
        content: agentPrompt,
        timestamp: new Date().toISOString(),
      });
    }
    // Seed pending approval if agent is waiting when chat opens
    if (initialAgentId && pendingApprovalId && pendingPermissionKind) {
      seed.push({
        id: genId(),
        type: 'approval',
        requestId: pendingApprovalId,
        agentId: initialAgentId,
        permissionKind: pendingPermissionKind,
        responded: false,
        timestamp: new Date().toISOString(),
      } as ApprovalMessage);
    }
    return seed;
  });
  const [isBusy, setIsBusy] = useState(initialStatus === 'running' && agentSource !== 'cli');
  const [status, setStatus] = useState(initialAgentId ? initialStatus : 'new');
  const [isLoadingHistory, setIsLoadingHistory] = useState(!!initialAgentId);
  const [historyLoaded, setHistoryLoaded] = useState(!initialAgentId);
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [cwd, setCwd] = useState<string>('');
  const [overlayAgentId, setOverlayAgentId] = useState<string | null>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Track the current streaming assistant message ID
  const currentAssistantId = useRef<string | null>(null);
  // Track the current reasoning message ID
  const currentReasoningId = useRef<string | null>(null);
  // Track whether history has been applied so buffered events can be merged
  const historyLoadedRef = useRef(!initialAgentId);
  // Buffer ALL events that arrive before history loads for replay with dedup
  const pendingEvents = useRef<ChatEvent[]>([]);

  // Load available models
  useEffect(() => {
    (async () => {
      const [modelList, currentModel] = await Promise.all([
        intentAPI.listModels(),
        intentAPI.getSetting('model'),
      ]);
      setModels(modelList);
      if (currentModel) setSelectedModel(currentModel);
      else if (modelList.length > 0) setSelectedModel(modelList[0].id);
    })();
  }, []);

  // Load CWD and listen for changes
  useEffect(() => {
    intentAPI.getSetting('workspace_root').then((val) => {
      if (val) setCwd(val);
    });
    intentAPI.onWorkspaceChanged((path) => setCwd(path || ''));
  }, []);

  // Close model dropdown on outside click
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen]);

  // Load conversation history for existing agents (especially CLI sessions)
  useEffect(() => {
    if (!initialAgentId) return;
    (async () => {
      try {
        const result = await intentAPI.getAgentHistory(initialAgentId);
        if (result.events && result.events.length > 0) {
          const historyMessages = parseHistoryEvents(result.events);
          if (historyMessages.length > 0) {
            setMessages(prev => {
              // Preserve seeded pending approval only if not already in history
              const pendingApproval = prev.find(m => m.type === 'approval');
              let msgs = historyMessages;
              if (pendingApproval && !msgs.some(
                m => m.type === 'approval' && m.requestId === (pendingApproval as ApprovalMessage).requestId
              )) {
                msgs = [...msgs, pendingApproval];
              }

              // Replay ALL buffered events with dedup against history
              const merged = replayBufferedEvents(msgs, pendingEvents.current);
              pendingEvents.current = [];
              return merged;
            });
          } else {
            // History returned events but none were parseable — still replay buffered events
            setMessages(prev => {
              const merged = replayBufferedEvents(prev, pendingEvents.current);
              pendingEvents.current = [];
              return merged;
            });
          }
        } else if ('error' in result && result.error) {
          // Resume failed — show error as session event so user knows why history is missing
          setMessages(prev => {
            const errorMsg: ChatMessage = {
              id: genId(),
              type: 'session_event',
              eventType: 'error',
              message: result.error as string,
              timestamp: new Date().toISOString(),
            };
            const merged = replayBufferedEvents([...prev, errorMsg], pendingEvents.current);
            pendingEvents.current = [];
            return merged;
          });
        } else {
          // No history events — replay buffered events against seeded messages
          setMessages(prev => {
            const merged = replayBufferedEvents(prev, pendingEvents.current);
            pendingEvents.current = [];
            return merged;
          });
        }
      } catch (err) {
        console.error('[ChatView] Failed to load history:', err);
        // Show error and replay any buffered events so they aren't lost
        setMessages(prev => {
          const errorMsg: ChatMessage = {
            id: genId(),
            type: 'session_event',
            eventType: 'error',
            message: `Failed to load conversation history: ${err instanceof Error ? err.message : 'Unknown error'}`,
            timestamp: new Date().toISOString(),
          };
          const merged = replayBufferedEvents([...prev, errorMsg], pendingEvents.current);
          pendingEvents.current = [];
          return merged;
        });
      } finally {
        historyLoadedRef.current = true;
        setIsLoadingHistory(false);
        setHistoryLoaded(true);
      }
    })();
  }, [initialAgentId]);

  // Subscribe to chat events immediately — buffer all events until history loads
  useEffect(() => {
    if (!currentAgentId) return;
    const unsubscribe = intentAPI.onChatEvent(currentAgentId, (event: ChatEvent) => {
      // Buffer ALL events that arrive before history loads for deduped replay
      if (!historyLoadedRef.current) {
        pendingEvents.current.push(event);
        return;
      }

      switch (event.type) {
        case 'assistant.message_delta': {
          setMessages(prev => {
            if (!currentAssistantId.current) {
              const id = genId();
              currentAssistantId.current = id;
              return [...prev, {
                id,
                type: 'assistant',
                content: event.delta,
                isStreaming: true,
                timestamp: new Date().toISOString(),
              } as AssistantMsgType];
            }
            return prev.map(m =>
              m.id === currentAssistantId.current && m.type === 'assistant'
                ? { ...m, content: m.content + event.delta }
                : m
            );
          });
          break;
        }

        case 'assistant.message': {
          if (currentAssistantId.current) {
            setMessages(prev => prev.map(m =>
              m.id === currentAssistantId.current && m.type === 'assistant'
                ? { ...m, isStreaming: false, content: event.content || m.content }
                : m
            ));
          } else {
            // Got full message without deltas
            setMessages(prev => [...prev, {
              id: genId(),
              type: 'assistant',
              content: event.content,
              isStreaming: false,
              timestamp: new Date().toISOString(),
            } as AssistantMsgType]);
          }
          currentAssistantId.current = null;
          break;
        }

        case 'assistant.reasoning_delta': {
          setMessages(prev => {
            if (!currentReasoningId.current || currentReasoningId.current !== event.reasoningId) {
              const id = genId();
              currentReasoningId.current = event.reasoningId;
              return [...prev, {
                id,
                type: 'reasoning',
                reasoningId: event.reasoningId,
                content: event.delta,
                isStreaming: true,
                timestamp: new Date().toISOString(),
              } as ReasoningMessage];
            }
            return prev.map(m =>
              m.type === 'reasoning' && m.reasoningId === event.reasoningId
                ? { ...m, content: m.content + event.delta }
                : m
            );
          });
          break;
        }

        case 'assistant.reasoning': {
          setMessages(prev => prev.map(m =>
            m.type === 'reasoning' && m.reasoningId === event.reasoningId
              ? { ...m, isStreaming: false }
              : m
          ));
          currentReasoningId.current = null;
          break;
        }

        case 'tool.start': {
          setMessages(prev => [...prev, {
            id: genId(),
            type: 'tool_call',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            completed: false,
            timestamp: new Date().toISOString(),
          } as ToolCallMessage]);
          break;
        }

        case 'tool.progress': {
          setMessages(prev => prev.map(m =>
            m.type === 'tool_call' && m.toolCallId === event.toolCallId
              ? { ...m, result: (m.result || '') + event.message }
              : m
          ));
          break;
        }

        case 'tool.complete': {
          setMessages(prev => prev.map(m =>
            m.type === 'tool_call' && m.toolCallId === event.toolCallId
              ? { ...m, completed: true, success: event.success, result: event.result, error: event.error }
              : m
          ));
          break;
        }

        case 'session.idle': {
          setIsBusy(false);
          setStatus('completed');
          currentAssistantId.current = null;
          currentReasoningId.current = null;
          break;
        }

        case 'session.error': {
          setIsBusy(false);
          setStatus('failed');
          currentAssistantId.current = null;
          currentReasoningId.current = null;
          setMessages(prev => [...prev, {
            id: genId(),
            type: 'session_event',
            eventType: 'error',
            message: event.message,
            timestamp: new Date().toISOString(),
          } as SessionEventMessage]);
          break;
        }

        case 'approval.needed': {
          setMessages(prev => [...prev, {
            id: genId(),
            type: 'approval',
            requestId: event.requestId,
            agentId: event.agentId,
            permissionKind: event.permissionKind,
            intention: event.intention,
            path: event.path,
            responded: false,
            timestamp: new Date().toISOString(),
          } as ApprovalMessage]);
          break;
        }

        case 'approval.resolved': {
          setMessages(prev => prev.map(m =>
            m.type === 'approval' && m.requestId === event.requestId
              ? { ...m, responded: true, approved: event.approved }
              : m
          ));
          break;
        }

        case 'user_input.requested': {
          setMessages(prev => [...prev, {
            id: genId(),
            type: 'user_input',
            requestId: event.requestId,
            agentId: event.agentId,
            question: event.question,
            choices: event.choices,
            allowFreeform: event.allowFreeform,
            responded: false,
            timestamp: new Date().toISOString(),
          } as UserInputMessage]);
          break;
        }

        case 'user_input.resolved': {
          setMessages(prev => prev.map(m =>
            m.type === 'user_input' && m.requestId === event.requestId
              ? { ...m, responded: true, answer: event.answer, wasFreeform: event.wasFreeform }
              : m
          ));
          break;
        }

        case 'elicitation.requested': {
          setMessages(prev => [...prev, {
            id: genId(),
            type: 'elicitation',
            requestId: event.requestId,
            agentId: event.agentId,
            message: event.message,
            requestedSchema: event.requestedSchema,
            mode: event.mode,
            elicitationSource: event.elicitationSource,
            responded: false,
            timestamp: new Date().toISOString(),
          } as ElicitationMessage]);
          break;
        }

        case 'elicitation.resolved': {
          setMessages(prev => prev.map(m =>
            m.type === 'elicitation' && m.requestId === event.requestId
              ? { ...m, responded: true, action: event.action, content: event.content }
              : m
          ));
          break;
        }

        case 'subagent.started': {
          setMessages(prev => [...prev, {
            id: genId(),
            type: 'tool_call',
            toolCallId: event.toolCallId,
            toolName: '__subagent__',
            args: {
              name: event.name,
              displayName: event.displayName,
              description: event.description,
              agentType: event.name,
              agentId: event.agentId,
              completed: false,
            },
            completed: false,
            timestamp: new Date().toISOString(),
          } as ToolCallMessage]);
          break;
        }

        case 'subagent.completed': {
          setMessages(prev => prev.map(m =>
            m.type === 'tool_call' && m.toolCallId === event.toolCallId
              ? {
                  ...m,
                  completed: true,
                  success: true,
                  args: {
                    ...m.args,
                    completed: true,
                    success: true,
                    agentId: event.agentId ?? m.args.agentId,
                    durationMs: event.durationMs,
                    model: event.model,
                    totalTokens: event.totalTokens,
                    totalToolCalls: event.totalToolCalls,
                  },
                }
              : m
          ));
          break;
        }

        case 'subagent.failed': {
          setMessages(prev => prev.map(m =>
            m.type === 'tool_call' && m.toolCallId === event.toolCallId
              ? {
                  ...m,
                  completed: true,
                  success: false,
                  args: {
                    ...m.args,
                    completed: true,
                    success: false,
                    error: event.error,
                    agentId: event.agentId ?? m.args.agentId,
                  },
                }
              : m
          ));
          break;
        }
      }
    });

    return () => unsubscribe();
  }, [currentAgentId]);

  const handleSend = useCallback(async (message: string, attachments?: Array<{ type: 'file'; name: string; path: string }>) => {
    const chatAttachments: ChatAttachment[] | undefined = attachments?.map(a => ({
      type: a.type,
      name: a.name,
      path: a.path,
    }));

    // Add user message to state
    setMessages(prev => [...prev, {
      id: genId(),
      type: 'user',
      content: message,
      attachments: chatAttachments,
      timestamp: new Date().toISOString(),
    }]);
    setIsBusy(true);
    setStatus('running');

    // If no agent yet, create one with this first message
    if (!currentAgentId) {
      const launchResult = await intentAPI.quickLaunchAgent(message);
      if ('error' in launchResult && launchResult.error) {
        setMessages(prev => [...prev, {
          id: genId(),
          type: 'session_event',
          eventType: 'error',
          message: launchResult.error,
          timestamp: new Date().toISOString(),
        } as SessionEventMessage]);
        setIsBusy(false);
        setStatus('failed');
        return;
      }
      // Set the new agent ID — useEffect will pick up the subscription
      setCurrentAgentId((launchResult as { agentId: string }).agentId);
      return;
    }

    const result = await intentAPI.sendChatMessage(currentAgentId, message, chatAttachments);
    if (result.error) {
      setMessages(prev => [...prev, {
        id: genId(),
        type: 'session_event',
        eventType: 'error',
        message: result.error,
        timestamp: new Date().toISOString(),
      } as SessionEventMessage]);
      setIsBusy(false);
    }
  }, [currentAgentId]);

  const handleApprovalRespond = useCallback((requestId: string, approved: boolean) => {
    if (!currentAgentId) return;
    intentAPI.approveAgent(currentAgentId, requestId, approved);
    setMessages(prev => prev.map(m =>
      m.type === 'approval' && m.requestId === requestId
        ? { ...m, responded: true, approved }
        : m
    ));
  }, [currentAgentId]);

  const handleUserInputRespond = useCallback((requestId: string, answer: string, wasFreeform: boolean) => {
    if (!currentAgentId) return;
    intentAPI.respondToUserInput(currentAgentId, requestId, answer, wasFreeform);
    setMessages(prev => prev.map(m =>
      m.type === 'user_input' && m.requestId === requestId
        ? { ...m, responded: true, answer, wasFreeform }
        : m
    ));
  }, [currentAgentId]);

  const handleElicitationRespond = useCallback((requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>) => {
    if (!currentAgentId) return;
    intentAPI.respondToElicitation(currentAgentId, requestId, action, content);
    setMessages(prev => prev.map(m =>
      m.type === 'elicitation' && m.requestId === requestId
        ? { ...m, responded: true, action, content }
        : m
    ));
  }, [currentAgentId]);

  const handleModelSwitch = useCallback(async (modelId: string) => {
    setSelectedModel(modelId);
    setModelDropdownOpen(false);
    if (currentAgentId) await intentAPI.setChatModel(currentAgentId, modelId);
  }, [currentAgentId]);

  const handleBrowseCwd = useCallback(async () => {
    await intentAPI.selectWorkspace();
  }, []);

  const handleAbort = useCallback(async () => {
    if (currentAgentId) await intentAPI.abortAgent(currentAgentId);
  }, [currentAgentId]);

  const statusIcon = status === 'new' ? '✦' :
                     status === 'running' ? '⚡' :
                     status === 'waiting-approval' ? '⏳' :
                     status === 'completed' ? '✓' :
                     status === 'failed' ? '✗' : '•';

  const statusLabel = status === 'new' ? 'New' :
                      status === 'waiting-approval' ? 'Waiting' :
                      status === 'completed' ? 'Completed' :
                      status === 'failed' ? 'Failed' : status;

  const selectedModelInfo = models.find(m => m.id === selectedModel);
  const cwdFolderName = cwd ? cwd.split('/').pop() || cwd : '';

  return (
    <div className="chat-container">
      <header className="chat-header">
        <button className="header-icon-btn" onClick={onClose} title="Back (Esc)">←</button>
        <div className="chat-header-info">
          <span className={`chat-status-badge ${status}`}>{statusIcon} {statusLabel}</span>
        </div>
        <div className="header-actions">
          {isBusy && (
            <button className="chat-abort-btn" onClick={handleAbort} title="Stop agent">
              ◼ Stop
            </button>
          )}
          {currentAgentId && (
            <button className="header-icon-btn" onClick={() => onOpenCli(currentAgentId)} title="Open in CLI">
              ⌨️
            </button>
          )}
        </div>
      </header>

      {/* Status bar: CWD + Model */}
      <div className="chat-status-bar">
        <button
          className={`chat-status-bar-item ${!cwd ? 'warning' : ''}`}
          onClick={handleBrowseCwd}
          title={cwd || 'Click to set working directory'}
        >
          <span className="chat-status-bar-icon">{cwd ? '📂' : '⚠️'}</span>
          <span className="chat-status-bar-text">
            {cwdFolderName || '(no directory)'}
          </span>
          <span className="chat-status-bar-chevron">▾</span>
        </button>

        <span className="chat-status-bar-divider">|</span>

        <div className="chat-status-bar-dropdown" ref={modelDropdownRef}>
          <button
            className="chat-status-bar-item"
            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
          >
            <span className="chat-status-bar-icon">🧠</span>
            <span className="chat-status-bar-text">
              {selectedModelInfo?.name || selectedModel || 'Select model'}
            </span>
            <span className={`chat-status-bar-chevron ${modelDropdownOpen ? 'open' : ''}`}>▾</span>
          </button>

          {modelDropdownOpen && (
            <div className="chat-model-dropdown">
              {models.map((m) => {
                const isSelected = m.id === selectedModel;
                return (
                  <button
                    key={m.id}
                    className={`chat-model-dropdown-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleModelSwitch(m.id)}
                  >
                    <span className="chat-model-dropdown-name">
                      {isSelected ? '✓ ' : ''}{m.name || m.id}
                    </span>
                  </button>
                );
              })}
              {models.length === 0 && (
                <div className="chat-model-dropdown-empty">Loading…</div>
              )}
            </div>
          )}
        </div>
      </div>

      {isLoadingHistory && (
        <div className="chat-loading-history">Loading conversation history...</div>
      )}

      <MessageList
        messages={messages}
        onApprovalRespond={handleApprovalRespond}
        onUserInputRespond={handleUserInputRespond}
        onElicitationRespond={handleElicitationRespond}
        parentAgentId={currentAgentId || ''}
        onOpenSubagentDetail={setOverlayAgentId}
      />

      <PromptBar
        onSend={handleSend}
        disabled={false}
        placeholder={
          !currentAgentId ? 'What would you like the agent to do?' :
          isBusy ? 'Agent is working...' :
          agentSource === 'cli' ? 'Continue this CLI session here...' :
          'Send a follow-up message...'
        }
      />

      {overlayAgentId && currentAgentId && (
        <SubagentDetailOverlay
          parentAgentId={currentAgentId}
          agentId={overlayAgentId}
          onClose={() => setOverlayAgentId(null)}
        />
      )}
    </div>
  );
}
