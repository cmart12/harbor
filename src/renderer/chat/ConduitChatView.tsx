/**
 * ConduitChatView — Chat component for Conduit agent sessions.
 *
 * Forks from ChatView with conduit-specific behavior:
 * - Models fetched from Conduit profile (not SDK)
 * - Model switch via session settings PATCH (not chat:set-model)
 * - Profile switcher in status bar
 * - Agent launch/send/abort routed through conduit IPC
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage, ChatEvent, ChatAttachment, AssistantMessage as AssistantMsgType, ToolCallMessage, ReasoningMessage, ApprovalMessage, UserInputMessage, ElicitationMessage, SessionEventMessage } from '../../shared/chat-types';
import { MessageList } from './MessageList';
import { PromptBar } from './PromptBar';

declare const whimAPI: {
  onChatEvent: (agentId: string, callback: (event: ChatEvent) => void) => () => void;
  getAgentHistory: (agentId: string) => Promise<{ events?: any[]; error?: string; restarted?: boolean }>;
  onAgentYoloChanged: (callback: (data: { agentId: string; enabled: boolean }) => void) => void;
  // Conduit-specific
  sendConduitMessage: (agentId: string, prompt: string) => Promise<{ error?: string }>;
  abortConduitAgent: (agentId: string) => Promise<any>;
  launchConduitAgent: (spaceId: string, prompt: string) => Promise<{ agentId: string; sessionId: string } | { error: string }>;
  approveConduitPermission?: (agentId: string, requestId: string, approved: boolean) => Promise<any>;
  respondToConduitUserInput?: (agentId: string, requestId: string, answer: string) => Promise<any>;
  // Profile/model
  listConduitProfiles: () => Promise<Array<{ id: string; name: string; description?: string; enabled: boolean; agentAdapter?: string }> | { error: string }>;
  listConduitProfileModels: (profileId: string) => Promise<Array<{ id: string; name?: string; provider?: string }> | { error: string }>;
  getConduitSessionSettings: (sessionId: string) => Promise<Record<string, unknown> | { error: string }>;
  updateConduitSessionSettings: (sessionId: string, settings: Record<string, unknown>) => Promise<any>;
  updateConduitSessionProfile: (sessionId: string, profileId: string) => Promise<any>;
  setAgentYolo: (agentId: string, enabled: boolean) => Promise<any>;
  // Fallback approval (in case conduit-specific isn't available)
  approveAgent: (agentId: string, requestId: string, approved: boolean) => Promise<void>;
  respondToUserInput: (agentId: string, requestId: string, answer: string, wasFreeform: boolean) => Promise<void>;
  respondToElicitation: (agentId: string, requestId: string, action: string, content?: Record<string, unknown>) => Promise<void>;
  [key: string]: any;
};

export interface ConduitChatViewProps {
  agentId?: string;
  conduitSessionId?: string;
  agentPrompt: string;
  agentStatus: string;
  spaceId?: string;
  pendingApprovalId?: string;
  pendingPermissionKind?: string;
  onClose: () => void;
}

let nextMsgId = 1;
function genId(): string { return `cmsg_${nextMsgId++}`; }

/**
 * Parse history events from getAgentHistory into ChatMessage array.
 * Reused from ChatView — same event format.
 */
function parseHistoryEvents(events: any[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const ev of events) {
    const d = ev.data ?? ev;
    const ts = ev.ts || new Date().toISOString();
    switch (ev.type) {
      case 'user.message':
        result.push({ id: genId(), type: 'user', content: d.message || d.content || '', timestamp: ts });
        break;
      case 'assistant.message':
        result.push({ id: genId(), type: 'assistant', content: d.content || '', isStreaming: false, timestamp: ts } as AssistantMsgType);
        break;
      case 'tool.execution_start':
        result.push({ id: genId(), type: 'tool_call', toolCallId: d.toolCallId || '', toolName: d.toolName || '', args: d.arguments || {}, completed: false, timestamp: ts } as ToolCallMessage);
        break;
      case 'tool.execution_complete': {
        const existing = result.find(m => m.type === 'tool_call' && m.toolCallId === d.toolCallId);
        if (existing && existing.type === 'tool_call') {
          existing.completed = true;
          existing.success = d.success !== false;
          const raw = d.result;
          existing.result = typeof raw === 'string' ? raw : raw?.detailedContent ?? raw?.content ?? '';
        }
        break;
      }
    }
  }
  return result;
}

export function ConduitChatView({
  agentId: initialAgentId,
  conduitSessionId: initialConduitSessionId,
  agentPrompt,
  agentStatus: initialStatus,
  spaceId,
  pendingApprovalId,
  pendingPermissionKind,
  onClose,
}: ConduitChatViewProps) {
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(initialAgentId || null);
  const [conduitSessionId, setConduitSessionId] = useState<string | null>(initialConduitSessionId || null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const seed: ChatMessage[] = [];
    if (agentPrompt) {
      seed.push({ id: genId(), type: 'user', content: agentPrompt, timestamp: new Date().toISOString() });
    }
    if (initialAgentId && pendingApprovalId && pendingPermissionKind) {
      seed.push({
        id: genId(), type: 'approval', requestId: pendingApprovalId,
        agentId: initialAgentId, permissionKind: pendingPermissionKind,
        responded: false, timestamp: new Date().toISOString(),
      } as ApprovalMessage);
    }
    return seed;
  });
  const [isBusy, setIsBusy] = useState(initialStatus === 'running');
  const [status, setStatus] = useState(initialAgentId ? initialStatus : 'new');
  const [isLoadingHistory, setIsLoadingHistory] = useState(!!initialAgentId);
  const [historyLoaded, setHistoryLoaded] = useState(!initialAgentId);
  const [yoloEnabled, setYoloEnabled] = useState(false);

  // ── Conduit-specific state ─────────────────────────────
  const [models, setModels] = useState<{ id: string; name?: string; provider?: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  const [profiles, setProfiles] = useState<Array<{ id: string; name: string; agentAdapter?: string }>>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [selectedProfileName, setSelectedProfileName] = useState<string>('');
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);

  // Streaming state refs
  const currentAssistantId = useRef<string | null>(null);
  const currentReasoningId = useRef<string | null>(null);
  const historyLoadedRef = useRef(!initialAgentId);
  const pendingEvents = useRef<ChatEvent[]>([]);

  // ── Load profiles and session settings ─────────────────
  useEffect(() => {
    (async () => {
      // Load profiles list
      const profileResult = await whimAPI.listConduitProfiles();
      if (!('error' in profileResult)) {
        const enabled = profileResult.filter(p => p.enabled);
        setProfiles(enabled);
      }

      // Load current session settings to get active model/profile
      if (conduitSessionId) {
        try {
          const settings = await whimAPI.getConduitSessionSettings(conduitSessionId) as any;
          if (settings && !settings.error) {
            if (settings.model) setSelectedModel(settings.model);
            if (settings.profileId) {
              setSelectedProfileId(settings.profileId);
              setSelectedProfileName(settings.profileName || '');
            }
            // Load models for this profile
            if (settings.profileId) {
              const modelResult = await whimAPI.listConduitProfileModels(settings.profileId);
              if (!('error' in modelResult)) {
                setModels(modelResult);
              }
            }
          }
        } catch { /* ignore */ }
      }
    })();
  }, [conduitSessionId]);

  // ── Close dropdowns on outside click ───────────────────
  useEffect(() => {
    if (!modelDropdownOpen && !profileDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target as Node)) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen, profileDropdownOpen]);

  // ── Yolo mode listener ─────────────────────────────────
  useEffect(() => {
    whimAPI.onAgentYoloChanged((data: { agentId: string; enabled: boolean }) => {
      if (data.agentId === currentAgentId) setYoloEnabled(data.enabled);
    });
  }, [currentAgentId]);

  // ── Load conversation history ──────────────────────────
  useEffect(() => {
    if (!initialAgentId) return;
    (async () => {
      try {
        const result = await whimAPI.getAgentHistory(initialAgentId);
        if (result.events && result.events.length > 0) {
          const historyMessages = parseHistoryEvents(result.events);
          if (historyMessages.length > 0) {
            setMessages(prev => {
              const pendingApproval = prev.find(m => m.type === 'approval');
              let msgs = historyMessages;
              if (pendingApproval && !msgs.some(m => m.type === 'approval' && m.requestId === (pendingApproval as ApprovalMessage).requestId)) {
                msgs = [...msgs, pendingApproval];
              }
              return msgs;
            });
          }
        }
      } catch (err) {
        console.error('[ConduitChat] Failed to load history:', err);
      } finally {
        historyLoadedRef.current = true;
        setIsLoadingHistory(false);
        setHistoryLoaded(true);
      }
    })();
  }, [initialAgentId]);

  // ── Subscribe to chat events ───────────────────────────
  // Same event handling as ChatView — events are mapped identically by conduit-runner
  useEffect(() => {
    if (!currentAgentId) return;
    const unsubscribe = whimAPI.onChatEvent(currentAgentId, (event: ChatEvent) => {
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
              return [...prev, { id, type: 'assistant', content: event.delta, isStreaming: true, timestamp: new Date().toISOString() } as AssistantMsgType];
            }
            return prev.map(m => m.id === currentAssistantId.current && m.type === 'assistant' ? { ...m, content: m.content + event.delta } : m);
          });
          break;
        }
        case 'assistant.message': {
          if (currentAssistantId.current) {
            setMessages(prev => prev.map(m => m.id === currentAssistantId.current && m.type === 'assistant' ? { ...m, isStreaming: false, content: event.content || m.content } : m));
          } else {
            setMessages(prev => [...prev, { id: genId(), type: 'assistant', content: event.content, isStreaming: false, timestamp: new Date().toISOString() } as AssistantMsgType]);
          }
          currentAssistantId.current = null;
          break;
        }
        case 'assistant.reasoning_delta': {
          setMessages(prev => {
            if (!currentReasoningId.current || currentReasoningId.current !== event.reasoningId) {
              const id = genId();
              currentReasoningId.current = event.reasoningId;
              return [...prev, { id, type: 'reasoning', reasoningId: event.reasoningId, content: event.delta, isStreaming: true, timestamp: new Date().toISOString() } as ReasoningMessage];
            }
            return prev.map(m => m.type === 'reasoning' && m.reasoningId === event.reasoningId ? { ...m, content: m.content + event.delta } : m);
          });
          break;
        }
        case 'assistant.reasoning': {
          setMessages(prev => prev.map(m => m.type === 'reasoning' && m.reasoningId === event.reasoningId ? { ...m, isStreaming: false } : m));
          currentReasoningId.current = null;
          break;
        }
        case 'tool.start': {
          setMessages(prev => [...prev, { id: genId(), type: 'tool_call', toolCallId: event.toolCallId, toolName: event.toolName, args: event.args, completed: false, timestamp: new Date().toISOString() } as ToolCallMessage]);
          break;
        }
        case 'tool.progress': {
          setMessages(prev => prev.map(m => m.type === 'tool_call' && m.toolCallId === event.toolCallId ? { ...m, result: (m.result || '') + event.message } : m));
          break;
        }
        case 'tool.complete': {
          setMessages(prev => prev.map(m => m.type === 'tool_call' && m.toolCallId === event.toolCallId ? { ...m, completed: true, success: event.success, result: event.result, error: event.error } : m));
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
          setMessages(prev => [...prev, { id: genId(), type: 'session_event', eventType: 'error', message: event.message, timestamp: new Date().toISOString() } as SessionEventMessage]);
          break;
        }
        case 'approval.needed': {
          setMessages(prev => [...prev, {
            id: genId(), type: 'approval', requestId: event.requestId, agentId: event.agentId,
            permissionKind: event.permissionKind, intention: event.intention, path: event.path,
            responded: false, timestamp: new Date().toISOString(),
          } as ApprovalMessage]);
          break;
        }
        case 'approval.resolved': {
          setMessages(prev => prev.map(m => m.type === 'approval' && m.requestId === event.requestId ? { ...m, responded: true, approved: event.approved } : m));
          break;
        }
        case 'user_input.requested': {
          setMessages(prev => [...prev, {
            id: genId(), type: 'user_input', requestId: event.requestId, agentId: event.agentId,
            question: event.question, choices: event.choices, allowFreeform: event.allowFreeform,
            responded: false, timestamp: new Date().toISOString(),
          } as UserInputMessage]);
          break;
        }
        case 'user_input.resolved': {
          setMessages(prev => prev.map(m => m.type === 'user_input' && m.requestId === event.requestId ? { ...m, responded: true, answer: event.answer, wasFreeform: event.wasFreeform } : m));
          break;
        }
        case 'elicitation.requested': {
          setMessages(prev => [...prev, {
            id: genId(), type: 'elicitation', requestId: event.requestId, agentId: event.agentId,
            message: event.message, requestedSchema: event.requestedSchema, mode: event.mode,
            responded: false, timestamp: new Date().toISOString(),
          } as ElicitationMessage]);
          break;
        }
        case 'elicitation.resolved': {
          setMessages(prev => prev.map(m => m.type === 'elicitation' && m.requestId === event.requestId ? { ...m, responded: true, action: event.action, content: event.content } : m));
          break;
        }
      }
    });
    return () => unsubscribe();
  }, [currentAgentId]);

  // ── Handlers ───────────────────────────────────────────

  const handleSend = useCallback(async (message: string) => {
    setMessages(prev => [...prev, { id: genId(), type: 'user', content: message, timestamp: new Date().toISOString() }]);
    setIsBusy(true);
    setStatus('running');

    if (!currentAgentId) {
      // Launch a new conduit agent
      const result = await whimAPI.launchConduitAgent(spaceId || '__workspace__', message);
      if ('error' in result && result.error) {
        setMessages(prev => [...prev, { id: genId(), type: 'session_event', eventType: 'error', message: result.error, timestamp: new Date().toISOString() } as SessionEventMessage]);
        setIsBusy(false);
        setStatus('failed');
        return;
      }
      const r = result as { agentId: string; sessionId: string };
      setCurrentAgentId(r.agentId);
      setConduitSessionId(r.sessionId);
      return;
    }

    const result = await whimAPI.sendConduitMessage(currentAgentId, message);
    if (result.error) {
      setMessages(prev => [...prev, { id: genId(), type: 'session_event', eventType: 'error', message: result.error!, timestamp: new Date().toISOString() } as SessionEventMessage]);
      setIsBusy(false);
    }
  }, [currentAgentId, spaceId]);

  const handleApprovalRespond = useCallback((requestId: string, approved: boolean) => {
    if (!currentAgentId) return;
    if (whimAPI.approveConduitPermission) {
      whimAPI.approveConduitPermission(currentAgentId, requestId, approved);
    } else {
      whimAPI.approveAgent(currentAgentId, requestId, approved);
    }
    setMessages(prev => prev.map(m => m.type === 'approval' && m.requestId === requestId ? { ...m, responded: true, approved } : m));
  }, [currentAgentId]);

  const handleUserInputRespond = useCallback((requestId: string, answer: string, wasFreeform: boolean) => {
    if (!currentAgentId) return;
    whimAPI.respondToUserInput(currentAgentId, requestId, answer, wasFreeform);
    setMessages(prev => prev.map(m => m.type === 'user_input' && m.requestId === requestId ? { ...m, responded: true, answer, wasFreeform } : m));
  }, [currentAgentId]);

  const handleElicitationRespond = useCallback((requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>) => {
    if (!currentAgentId) return;
    whimAPI.respondToElicitation(currentAgentId, requestId, action, content);
    setMessages(prev => prev.map(m => m.type === 'elicitation' && m.requestId === requestId ? { ...m, responded: true, action, content } : m));
  }, [currentAgentId]);

  const handleModelSwitch = useCallback(async (modelId: string) => {
    setSelectedModel(modelId);
    setModelDropdownOpen(false);
    if (conduitSessionId) {
      await whimAPI.updateConduitSessionSettings(conduitSessionId, { model: modelId });
    }
  }, [conduitSessionId]);

  const handleProfileSwitch = useCallback(async (profileId: string) => {
    const profile = profiles.find(p => p.id === profileId);
    setSelectedProfileId(profileId);
    setSelectedProfileName(profile?.name || '');
    setProfileDropdownOpen(false);
    if (conduitSessionId) {
      await whimAPI.updateConduitSessionProfile(conduitSessionId, profileId);
      // Reload models for the new profile
      const modelResult = await whimAPI.listConduitProfileModels(profileId);
      if (!('error' in modelResult)) {
        setModels(modelResult);
        // Select first model from new profile
        if (modelResult.length > 0) {
          setSelectedModel(modelResult[0].id);
        }
      }
    }
  }, [conduitSessionId, profiles]);

  const handleToggleYolo = useCallback(async () => {
    if (currentAgentId) await whimAPI.setAgentYolo(currentAgentId, !yoloEnabled);
  }, [currentAgentId, yoloEnabled]);

  const handleAbort = useCallback(async () => {
    if (currentAgentId) await whimAPI.abortConduitAgent(currentAgentId);
  }, [currentAgentId]);

  // ── Render ─────────────────────────────────────────────

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

  return (
    <div className="chat-container">
      <header className="chat-header">
        <button className="header-icon-btn" onClick={onClose} title="Back (Esc)">←</button>
        <div className="chat-header-info">
          <span className={`chat-status-badge ${status}`}>{statusIcon} {statusLabel}</span>
          <span className="chat-source-badge conduit">🔗 Conduit</span>
        </div>
        <div className="header-actions">
          {isBusy && (
            <button className="chat-abort-btn" onClick={handleAbort} title="Stop agent">
              ◼ Stop
            </button>
          )}
        </div>
      </header>

      {/* Status bar: Profile + Model + Yolo */}
      <div className="chat-status-bar">
        {/* Profile switcher */}
        <div className="chat-status-bar-dropdown" ref={profileDropdownRef}>
          <button
            className="chat-status-bar-item"
            onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
          >
            <span className="chat-status-bar-icon">👤</span>
            <span className="chat-status-bar-text">
              {selectedProfileName || 'Profile'}
            </span>
            <span className={`chat-status-bar-chevron ${profileDropdownOpen ? 'open' : ''}`}>▾</span>
          </button>

          {profileDropdownOpen && (
            <div className="chat-model-dropdown">
              {profiles.map(p => {
                const isSelected = p.id === selectedProfileId;
                return (
                  <button
                    key={p.id}
                    className={`chat-model-dropdown-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleProfileSwitch(p.id)}
                  >
                    <span className="chat-model-dropdown-name">
                      {isSelected ? '✓ ' : ''}{p.name}{p.agentAdapter ? ` (${p.agentAdapter})` : ''}
                    </span>
                  </button>
                );
              })}
              {profiles.length === 0 && (
                <div className="chat-model-dropdown-empty">No profiles</div>
              )}
            </div>
          )}
        </div>

        <span className="chat-status-bar-divider">|</span>

        {/* Model picker */}
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
              {models.map(m => {
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

        <span className="chat-status-bar-divider">|</span>

        {/* Yolo toggle */}
        <button
          className={`chat-status-bar-item chat-yolo-btn${yoloEnabled ? ' active' : ''}`}
          onClick={handleToggleYolo}
          title={yoloEnabled ? 'Yolo mode ON — auto-approving all permissions' : 'Enable yolo mode (auto-approve all)'}
        >
          <span className="chat-status-bar-icon">🔥</span>
          <span className="chat-status-bar-text">
            {yoloEnabled ? 'YOLO' : 'Yolo'}
          </span>
        </button>
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
      />

      <PromptBar
        onSend={handleSend}
        disabled={false}
        placeholder={
          !currentAgentId ? 'What would you like the Conduit agent to do?' :
          isBusy ? 'Agent is working...' :
          'Send a follow-up message...'
        }
      />
    </div>
  );
}
