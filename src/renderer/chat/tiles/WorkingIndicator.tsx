import React from 'react';

interface WorkingIndicatorProps {
  /** One-line preview of streaming thinking tokens */
  thinkingPreview?: string;
  /** One-line preview of streaming assistant tokens */
  outputPreview?: string;
}

export function WorkingIndicator({ thinkingPreview, outputPreview }: WorkingIndicatorProps) {
  const preview = outputPreview || thinkingPreview;

  return (
    <div className="chat-working-indicator">
      <div className="chat-working-dots">
        <span className="chat-working-dot" />
        <span className="chat-working-dot" />
        <span className="chat-working-dot" />
      </div>
      <span className="chat-working-label">Working</span>
      {preview && (
        <span className="chat-working-preview">
          <span className="chat-working-preview-text">{preview}</span>
        </span>
      )}
    </div>
  );
}
