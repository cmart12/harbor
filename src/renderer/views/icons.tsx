import React from 'react';

/**
 * Inline status icon for agent cards. Matches the SVGs hand-written in
 * legacy app.ts (renderAgentsList line ~3847-3850) to keep visual parity.
 */
export interface AgentStatusIconProps {
  status: string;
}

export function AgentStatusIcon({ status }: AgentStatusIconProps): React.ReactElement {
  switch (status) {
    case 'running':
      return (
        <svg className="agent-icon-svg agent-icon-running" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="8" stroke="#a855f7" strokeWidth="2" strokeDasharray="12 38" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 9 9" to="360 9 9" dur="0.8s" repeatCount="indefinite" />
          </circle>
          <circle cx="9" cy="9" r="4" fill="#a855f7" opacity="0.3" />
        </svg>
      );
    case 'waiting-approval':
      return (
        <svg className="agent-icon-svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="8" fill="#f59e0b" opacity="0.15" stroke="#f59e0b" strokeWidth="1.5" />
          <circle cx="9" cy="9" r="3.5" stroke="#f59e0b" strokeWidth="1.5" fill="none" />
          <path d="M9 7V9.5L10.5 10.5" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'completed':
      return (
        <svg className="agent-icon-svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="9" fill="#22c55e" />
          <path d="M5.5 9.5L7.8 11.8L12.5 6.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg className="agent-icon-svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="9" fill="#ef4444" />
          <path d="M6 6L12 12M12 6L6 12" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

/**
 * Inline step status icon (done/failed/running). Matches legacy app.ts
 * renderAgentsList (~3878-3880).
 */
export interface StepIconProps {
  status: 'running' | 'done' | 'failed';
}

export function StepIcon({ status }: StepIconProps): React.ReactElement {
  if (status === 'done') {
    return (
      <span className="step-icon step-done">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5.5L4.2 7.5L8 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="step-icon step-failed">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return <span className="step-icon step-running" />;
}
