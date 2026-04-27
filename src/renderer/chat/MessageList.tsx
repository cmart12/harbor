import React, { useRef, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../../shared/chat-types';
import { UserBubble } from './tiles/UserBubble';
import { AssistantMessage } from './tiles/AssistantMessage';
import { ToolTile } from './tiles/ToolTile';
import { SubagentTile } from './tiles/SubagentTile';
import { ReasoningTile } from './tiles/ReasoningTile';
import { ApprovalTile } from './tiles/ApprovalTile';
import { UserInputTile } from './tiles/UserInputTile';
import { ElicitationTile } from './tiles/ElicitationTile';

interface MessageListProps {
  messages: ChatMessage[];
  onApprovalRespond: (requestId: string, approved: boolean) => void;
  onUserInputRespond: (requestId: string, answer: string, wasFreeform: boolean) => void;
  onElicitationRespond: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>) => void;
  parentAgentId?: string;
  onOpenSubagentDetail?: (agentId: string) => void;
}

export function MessageList({ messages, onApprovalRespond, onUserInputRespond, onElicitationRespond, parentAgentId, onOpenSubagentDetail }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 100;
    userScrolledUp.current = el.scrollHeight - el.scrollTop - el.clientHeight > threshold;
  }, []);

  useEffect(() => {
    if (!userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="chat-messages" ref={containerRef}>
        <div className="chat-empty-state">
          <span className="chat-empty-icon">💬</span>
          <span>Watching agent activity...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-messages" ref={containerRef} onScroll={handleScroll}>
      {messages.map((msg) => {
        switch (msg.type) {
          case 'user':
            return <UserBubble key={msg.id} content={msg.content} timestamp={msg.timestamp} attachments={msg.attachments} />;
          case 'assistant':
            return <AssistantMessage key={msg.id} content={msg.content} isStreaming={msg.isStreaming} />;
          case 'tool_call': {
            if (msg.toolName === '__subagent__') {
              return (
                <SubagentTile
                  key={msg.id}
                  toolCallId={msg.toolCallId}
                  name={String(msg.args.name || '')}
                  displayName={String(msg.args.displayName || 'Sub-agent')}
                  description={String(msg.args.description || '')}
                  agentType={String(msg.args.agentType || '')}
                  agentId={msg.args.agentId as string | undefined}
                  completed={msg.completed}
                  success={msg.success}
                  error={msg.args.error as string | undefined}
                  durationMs={msg.args.durationMs as number | undefined}
                  model={msg.args.model as string | undefined}
                  totalTokens={msg.args.totalTokens as number | undefined}
                  totalToolCalls={msg.args.totalToolCalls as number | undefined}
                  parentAgentId={parentAgentId || ''}
                  onOpenDetail={onOpenSubagentDetail}
                />
              );
            }
            return (
              <ToolTile
                key={msg.id}
                toolName={msg.toolName}
                args={msg.args}
                result={msg.result}
                completed={msg.completed}
                success={msg.success}
                error={msg.error}
              />
            );
          }
          case 'reasoning':
            return <ReasoningTile key={msg.id} content={msg.content} isStreaming={msg.isStreaming} />;
          case 'approval':
            return (
              <ApprovalTile
                key={msg.id}
                requestId={msg.requestId}
                permissionKind={msg.permissionKind}
                intention={msg.intention}
                path={msg.path}
                responded={msg.responded}
                approved={msg.approved}
                onRespond={onApprovalRespond}
              />
            );
          case 'session_event':
            return (
              <div key={msg.id} className={`chat-session-event ${msg.eventType}`}>
                {msg.eventType === 'error' ? '⚠️' : msg.eventType === 'info' ? 'ℹ️' : msg.eventType === 'completed' ? '✓' : '•'}{' '}
                {msg.message || msg.eventType}
              </div>
            );
          case 'user_input':
            return (
              <UserInputTile
                key={msg.id}
                requestId={msg.requestId}
                question={msg.question}
                choices={msg.choices}
                allowFreeform={msg.allowFreeform}
                responded={msg.responded}
                answer={msg.answer}
                wasFreeform={msg.wasFreeform}
                onRespond={onUserInputRespond}
              />
            );
          case 'elicitation':
            return (
              <ElicitationTile
                key={msg.id}
                requestId={msg.requestId}
                message={msg.message}
                requestedSchema={msg.requestedSchema}
                mode={msg.mode}
                elicitationSource={msg.elicitationSource}
                responded={msg.responded}
                action={msg.action}
                content={msg.content}
                onRespond={onElicitationRespond}
              />
            );
          default:
            return null;
        }
      })}
      <div ref={bottomRef} />
    </div>
  );
}
