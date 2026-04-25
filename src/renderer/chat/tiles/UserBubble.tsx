import React from 'react';
import type { ChatAttachment } from '../../../shared/chat-types';

interface UserBubbleProps {
  content: string;
  timestamp: string;
  attachments?: ChatAttachment[];
}

export function UserBubble({ content, timestamp, attachments }: UserBubbleProps) {
  const time = new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className="chat-user-bubble">
      <div className="chat-user-content">{content}</div>
      {attachments && attachments.length > 0 && (
        <div className="chat-attachment-chips">
          {attachments.map((att, i) => (
            <span key={i} className="chat-attachment-chip" title={att.path}>
              📎 {att.name}
            </span>
          ))}
        </div>
      )}
      <div className="chat-message-time">{time}</div>
    </div>
  );
}
