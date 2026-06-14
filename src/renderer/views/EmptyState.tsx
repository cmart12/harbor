import React from 'react';

/**
 * Shared empty-state for the main lists. One cohesive look across Spaces,
 * Workers, Skills, and Activity: a tinted icon, a headline, an optional
 * supporting line, and an optional primary call-to-action.
 *
 * Search-result empties pass just `icon` + `title` (no CTA) so a "no matches"
 * state reads as a calm dead-end rather than an invitation to create.
 */
export interface EmptyStateProps {
  icon: string;
  title: string;
  text?: string;
  cta?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, text, cta }: EmptyStateProps): React.ReactElement {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">{icon}</span>
      <span className="empty-state-title">{title}</span>
      {text ? <span className="empty-state-text">{text}</span> : null}
      {cta ? (
        <button type="button" className="empty-state-cta" onClick={cta.onClick}>
          {cta.label}
        </button>
      ) : null}
    </div>
  );
}

/** Focus the main capture textarea (used by empty-state CTAs). */
export function focusCaptureInput(): void {
  const el = document.getElementById('description-input') as HTMLTextAreaElement | null;
  el?.focus();
}
