import React, { useState, useRef, useEffect } from 'react';

interface ReasoningTileProps {
  content: string;
  isStreaming: boolean;
}

export function ReasoningTile({ content, isStreaming }: ReasoningTileProps) {
  const [collapsed, setCollapsed] = useState(false);
  const contentRef = useRef<HTMLPreElement>(null);

  // Auto-scroll to bottom when streaming and visible
  useEffect(() => {
    if (isStreaming && !collapsed && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, isStreaming, collapsed]);

  if (!content) return null;

  return (
    <div className="chat-reasoning-tile">
      <div
        className="chat-reasoning-header"
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        tabIndex={0}
      >
        <span className={`chat-reasoning-icon ${isStreaming ? 'pulse' : ''}`}>🧠</span>
        <span className="chat-reasoning-label">
          {isStreaming ? 'Thinking…' : 'Thought process'}
        </span>
        <span className={`chat-tool-chevron ${collapsed ? '' : 'expanded'}`}>
          {collapsed ? '▸' : '▾'}
        </span>
      </div>

      {/* Content — visible by default, collapsible */}
      <div className={`chat-reasoning-content-wrapper ${collapsed ? '' : 'expanded'}`}>
        <pre ref={contentRef} className="chat-reasoning-content">
          {content}
          {isStreaming && <span className="chat-reasoning-cursor">▍</span>}
        </pre>
      </div>
    </div>
  );
}
