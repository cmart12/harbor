import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { SubagentInfo, SubagentType } from '../../shared/subagent-types';
import type { ChatMessage } from '../../shared/chat-types';
import { MessageList } from './MessageList';

declare const intentAPI: {
  subagentAPI: {
    read: (parentAgentId: string, agentId: string) => Promise<SubagentInfo | null>;
    write: (parentAgentId: string, agentId: string, message: string) => Promise<{ error?: string }>;
    cancel: (parentAgentId: string, agentId: string) => Promise<void>;
    onChanged: (parentAgentId: string, callback: () => void) => () => void;
  };
  [key: string]: any;
};

interface SubagentDetailOverlayProps {
  parentAgentId: string;
  agentId: string | null;
  onClose: () => void;
}

const AGENT_ICONS: Record<string, string> = {
  explore: '🔍',
  'general-purpose': '🧠',
  task: '⚡',
  'rubber-duck': '🦆',
  'code-review': '📋',
  'configure-copilot': '⚙️',
};

function iconForType(agentType: SubagentType): string {
  return AGENT_ICONS[agentType] ?? '🤖';
}

const STATUS_COLORS: Record<string, string> = {
  running: '#22c55e',
  idle: '#eab308',
  completed: '#3b82f6',
  failed: '#ef4444',
  cancelled: '#9ca3af',
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function agentToMessages(agent: SubagentInfo): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  let nextId = 0;

  for (const turn of agent.turns) {
    if (turn.inboundMessage) {
      msgs.push({
        id: `sa-${agent.agentId}-in-${nextId++}`,
        type: 'user',
        content: turn.inboundMessage.fromAgentId
          ? `[From ${turn.inboundMessage.fromAgentId}] ${turn.inboundMessage.content}`
          : turn.inboundMessage.content,
        timestamp: new Date(turn.timestamp).toISOString(),
      });
    }
    if (turn.response) {
      msgs.push({
        id: `sa-${agent.agentId}-resp-${nextId++}`,
        type: 'assistant',
        content: turn.response,
        isStreaming: false,
        timestamp: new Date(turn.timestamp).toISOString(),
      });
    }
  }

  for (const tc of agent.toolCalls) {
    msgs.push({
      id: `sa-${agent.agentId}-tc-${tc.toolCallId}`,
      type: 'tool_call',
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      args: tc.args,
      result: tc.result,
      completed: tc.completed,
      success: tc.success,
      timestamp: new Date(tc.startedAt).toISOString(),
    });
  }

  if (agent.streamingContent) {
    msgs.push({
      id: `sa-${agent.agentId}-stream`,
      type: 'assistant',
      content: agent.streamingContent,
      isStreaming: agent.status === 'running',
      timestamp: new Date().toISOString(),
    });
  }

  msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return msgs;
}

export function SubagentDetailOverlay({ parentAgentId, agentId, onClose }: SubagentDetailOverlayProps) {
  const [agent, setAgent] = useState<SubagentInfo | null>(null);
  const [steerInput, setSteerInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!agentId) return;
    const info = await intentAPI.subagentAPI.read(parentAgentId, agentId);
    setAgent(info);
  }, [parentAgentId, agentId]);

  // Poll + listen for changes
  useEffect(() => {
    if (!agentId) return;
    refresh();
    const interval = setInterval(refresh, 1500);
    const unsubscribe = intentAPI.subagentAPI.onChanged(parentAgentId, refresh);
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [parentAgentId, agentId, refresh]);

  // Auto-scroll on agent updates
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [agent]);

  // Focus input on open
  useEffect(() => {
    if (agentId) inputRef.current?.focus();
  }, [agentId]);

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!agentId) return null;

  const isActive = agent?.status === 'running' || agent?.status === 'idle';
  const elapsed = agent
    ? (agent.completedAt ?? Date.now()) - agent.startedAt
    : 0;
  const totalTokens = agent
    ? (agent.progress.totalInputTokens + agent.progress.totalOutputTokens)
    : 0;

  const handleSend = async () => {
    if (!steerInput.trim() || !agent || !isActive || !agentId) return;
    setSending(true);
    setSendError(null);
    try {
      const result = await intentAPI.subagentAPI.write(parentAgentId, agentId, steerInput.trim());
      if (result?.error) {
        setSendError(result.error);
      } else {
        setSteerInput('');
      }
    } catch (err: any) {
      setSendError(err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleCancel = async () => {
    if (!agent || !isActive || !agentId) return;
    await intentAPI.subagentAPI.cancel(parentAgentId, agentId);
  };

  const messages = agent ? agentToMessages(agent) : [];
  const noopApproval = () => {};

  return (
    <>
      <div className="chat-subagent-overlay-backdrop" onClick={onClose} />
      <div className="chat-subagent-overlay-container">
        <div className="chat-subagent-overlay-panel" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="chat-subagent-overlay-header">
            <div className="chat-subagent-overlay-header-left">
              <span className="chat-subagent-overlay-icon">
                {agent ? iconForType(agent.agentType) : '🤖'}
              </span>
              <span className="chat-subagent-overlay-name">
                {agent?.displayName ?? agentId}
              </span>
              {agent && (
                <span
                  className="chat-subagent-overlay-status"
                  style={{ color: STATUS_COLORS[agent.status] ?? '#9ca3af' }}
                >
                  ● {agent.status}
                </span>
              )}
            </div>
            <div className="chat-subagent-overlay-header-right">
              {isActive && (
                <button className="chat-subagent-overlay-cancel-btn" onClick={handleCancel}>
                  ◼ Cancel
                </button>
              )}
              <button className="chat-subagent-overlay-close-btn" onClick={onClose}>✕</button>
            </div>
          </div>

          {/* Stats */}
          {agent && (
            <div className="chat-subagent-overlay-stats">
              <span>⏱ {formatElapsed(elapsed)}</span>
              <span>🔧 {agent.progress.toolCallsCompleted}</span>
              <span>🎰 {formatTokens(totalTokens)}</span>
              {agent.progress.resolvedModel && <span>{agent.progress.resolvedModel}</span>}
              {agent.progress.currentIntent && (
                <span className="chat-subagent-overlay-intent">{agent.progress.currentIntent}</span>
              )}
            </div>
          )}

          {/* Description */}
          {agent?.description && (
            <div className="chat-subagent-overlay-description">{agent.description}</div>
          )}

          {/* Conversation body */}
          <div className="chat-subagent-overlay-body" ref={scrollRef}>
            <MessageList messages={messages} onApprovalRespond={noopApproval} />
          </div>

          {/* Error banner */}
          {agent?.error && (
            <div className="chat-subagent-overlay-error">⚠️ {agent.error}</div>
          )}

          {/* Steering input bar */}
          <div className="chat-subagent-overlay-input-bar">
            <input
              ref={inputRef}
              type="text"
              className="chat-subagent-overlay-input"
              value={steerInput}
              onChange={(e) => setSteerInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={isActive ? 'Send steering instructions…' : 'Agent is no longer active'}
              disabled={!isActive || sending}
            />
            <button
              className="chat-subagent-overlay-send-btn"
              onClick={handleSend}
              disabled={!isActive || sending || !steerInput.trim()}
            >
              {sending ? '…' : 'Send'}
            </button>
          </div>
          {sendError && (
            <div className="chat-subagent-overlay-send-error">{sendError}</div>
          )}
        </div>
      </div>
    </>
  );
}
