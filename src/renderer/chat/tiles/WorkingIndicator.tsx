import React from 'react';

interface WorkingIndicatorProps {
  /** One-line preview of streaming thinking tokens */
  thinkingPreview?: string;
  /** One-line preview of streaming assistant tokens */
  outputPreview?: string;
  /** Name of the tool currently in flight (e.g. "bash", "view"), if any. */
  activeToolName?: string;
}

function friendlyToolName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'bash' || lower === 'shell' || lower === 'powershell') return 'running a command';
  if (lower.includes('write') || lower.includes('edit') || lower.includes('create')) return 'editing files';
  if (lower.includes('read') || lower === 'view' || lower === 'grep' || lower === 'glob') return 'reading files';
  if (lower === 'web_fetch' || lower === 'web_search') return 'searching the web';
  return name.replace(/_/g, ' ');
}

export function WorkingIndicator({ thinkingPreview, outputPreview, activeToolName }: WorkingIndicatorProps) {
  const preview = outputPreview || thinkingPreview;
  const subLabel = activeToolName ? friendlyToolName(activeToolName) : undefined;

  return (
    <div className="chat-working-indicator">
      <span className="chat-working-pulse" aria-hidden="true">
        <span className="chat-working-pulse-core" />
        <span className="chat-working-pulse-ring" />
      </span>
      <span className="chat-working-label">
        Working
        {subLabel && <span className="chat-working-sublabel"> · {subLabel}</span>}
      </span>
      {preview && (
        <span className="chat-working-preview">
          <span className="chat-working-preview-text">{preview}</span>
        </span>
      )}
    </div>
  );
}
