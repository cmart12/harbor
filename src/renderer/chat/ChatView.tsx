import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage, ChatEvent, AssistantMessage as AssistantMsgType, ToolCallMessage, ReasoningMessage, ApprovalMessage, SessionEventMessage } from '../../shared/chat-types';
import { MessageList } from './MessageList';
import { PromptBar } from './PromptBar';

declare const intentAPI: {
  sendChatMessage: (agentId: string, prompt: string, attachments?: any[]) => Promise<{ error?: string }>;
  onChatEvent: (agentId: string, callback: (event: ChatEvent) => void) => () => void;
  approveAgent: (agentId: string, requestId: string, approved: boolean) => Promise<void>;
  openAgentCli: (agentId: string) => Promise<any>;
  abortAgent: (agentId: string) => Promise<void>;
  listModels: () => Promise<{ id: string; name?: string }[]>;
  getSetting: (key: string) => Promise<string | null>;
  setChatModel: (agentId: string, model: string) => Promise<{ error?: string }>;
  quickLaunchAgent: (prompt: string) => Promise<{ agentId: string; sessionId: string } | { error: string }>;
  [key: string]: any;
};

interface ChatViewProps {
  agentId?: string;
  agentPrompt: string;
  agentStatus: string;
  onClose: () => void;
  onOpenCli: (agentId: string) => void;
}

let nextMsgId = 1;
function genId(): string {
  return `msg-${nextMsgId++}`;
}

export function ChatView({ agentId: initialAgentId, agentPrompt, agentStatus: initialStatus, onClose, onOpenCli }: ChatViewProps) {
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(initialAgentId || null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
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
    return seed;
  });
  const [isBusy, setIsBusy] = useState(initialStatus === 'running');
  const [status, setStatus] = useState(initialAgentId ? initialStatus : 'new');
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');

  // Track the current streaming assistant message ID
  const currentAssistantId = useRef<string | null>(null);
  // Track the current reasoning message ID
  const currentReasoningId = useRef<string | null>(null);

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

  // Subscribe to chat events
  useEffect(() => {
    if (!currentAgentId) return;
    const unsubscribe = intentAPI.onChatEvent(currentAgentId, (event: ChatEvent) => {
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
              ? { ...m, completed: true, success: event.success, result: event.result }
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
            responded: false,
            timestamp: new Date().toISOString(),
          } as ApprovalMessage]);
          break;
        }
      }
    });

    return () => unsubscribe();
  }, [currentAgentId]);

  const handleSend = useCallback(async (message: string) => {
    // Add user message to state
    setMessages(prev => [...prev, {
      id: genId(),
      type: 'user',
      content: message,
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
      setCurrentAgentId(launchResult.agentId);
      return;
    }

    const result = await intentAPI.sendChatMessage(currentAgentId, message);
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

  const handleModelChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const model = e.target.value;
    setSelectedModel(model);
    if (currentAgentId) await intentAPI.setChatModel(currentAgentId, model);
  }, [currentAgentId]);

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

  return (
    <div className="chat-container">
      <header className="chat-header">
        <button className="header-icon-btn" onClick={onClose} title="Back (Esc)">←</button>
        <div className="chat-header-info">
          <span className={`chat-status-badge ${status}`}>{statusIcon} {statusLabel}</span>
          {models.length > 0 && (
            <select
              className="chat-model-select"
              value={selectedModel}
              onChange={handleModelChange}
              title="Model"
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.name || m.id}</option>
              ))}
            </select>
          )}
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

      <MessageList messages={messages} onApprovalRespond={handleApprovalRespond} />

      <PromptBar
        onSend={handleSend}
        disabled={false}
        placeholder={!currentAgentId ? 'What would you like the agent to do?' : isBusy ? 'Agent is working...' : 'Send a follow-up message...'}
      />
    </div>
  );
}
