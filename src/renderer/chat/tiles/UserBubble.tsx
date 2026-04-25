import React from 'react';

interface UserBubbleProps {
  content: string;
  timestamp: string;
}

export function UserBubble({ content, timestamp }: UserBubbleProps) {
  const time = new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className="chat-user-bubble">
      <div className="chat-user-content">{content}</div>
      <div className="chat-message-time">{time}</div>
    </div>
  );
}
