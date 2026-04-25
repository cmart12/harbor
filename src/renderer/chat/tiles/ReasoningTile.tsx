import React, { useState, useRef, useEffect } from 'react';

interface ReasoningTileProps {
  content: string;
  isStreaming: boolean;
}

export function ReasoningTile({ content, isStreaming }: ReasoningTileProps) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLPreElement>(null);

  // Auto-scroll to bottom when streaming and expanded
  useEffect(() => {
    if (isStreaming && expanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, isStreaming, expanded]);

  if (!content) return null;

  const preview = content.length > 80 ? content.slice(0, 80) + '…' : content;

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
          {isStreaming ? 'Thinking…' : 'Thought process'}
        </span>
        <span className={`chat-tool-chevron ${expanded ? 'expanded' : ''}`}>
          {expanded ? '▾' : '▸'}
        </span>
      </div>

      {/* Collapsed preview */}
      {!expanded && content && (
        <div className="chat-reasoning-preview">{preview}</div>
      )}

      {/* Expanded content with CSS transition */}
      <div className={`chat-reasoning-content-wrapper ${expanded ? 'expanded' : ''}`}>
        <pre ref={contentRef} className="chat-reasoning-content">
          {content}
          {isStreaming && <span className="chat-reasoning-cursor">▍</span>}
        </pre>
      </div>
    </div>
  );
}
