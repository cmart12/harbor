import React, { useState } from 'react';

interface ReasoningTileProps {
  content: string;
  isStreaming: boolean;
}

export function ReasoningTile({ content, isStreaming }: ReasoningTileProps) {
  const [expanded, setExpanded] = useState(false);

  if (!content) return null;

  return (
    <div className="chat-reasoning-tile">
      <div
        className="chat-reasoning-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
      >
        <span className={`chat-reasoning-icon ${isStreaming ? 'pulse' : ''}`}>🧠</span>
        <span className="chat-reasoning-label">
          {isStreaming ? 'Thinking...' : 'Thought process'}
        </span>
        <span className={`chat-tool-chevron ${expanded ? 'expanded' : ''}`}>▸</span>
      </div>
      {expanded && (
        <div className="chat-reasoning-content">
          {content}
          {isStreaming && <span className="streaming-cursor">▌</span>}
        </div>
      )}
    </div>
  );
}
