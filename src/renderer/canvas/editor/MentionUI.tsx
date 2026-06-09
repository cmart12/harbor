import React, { useEffect } from 'react';
import type { Rect } from './geometry';

export interface MentionCandidate {
  handle: string;
  emoji?: string;
  model?: string;
}

/**
 * `@`-mention suggestion popup. Selection/keyboard state is owned by the host
 * (so it can intercept Arrow/Enter/Escape before the editor consumes them); this
 * component is presentational.
 */
export function MentionPopup({
  rect,
  candidates,
  activeIndex,
  onSelect,
  onHover,
}: {
  rect: Rect;
  candidates: MentionCandidate[];
  activeIndex: number;
  onSelect: (handle: string) => void;
  onHover: (index: number) => void;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (candidates.length === 0) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.round(rect.left),
    top: Math.round(rect.bottom + 4),
    zIndex: 122,
  };

  return (
    <div className="md-mention-popup" style={style} ref={listRef} onMouseDown={(e) => e.preventDefault()}>
      {candidates.map((c, i) => (
        <button
          key={c.handle}
          data-idx={i}
          className={`md-mention-item${i === activeIndex ? ' active' : ''}`}
          onMouseEnter={() => onHover(i)}
          onClick={() => onSelect(c.handle)}
        >
          <span className="md-mention-emoji">{c.emoji || '🤖'}</span>
          <span className="md-mention-handle">@{c.handle}</span>
          {c.model && <span className="md-mention-model">{c.model}</span>}
        </button>
      ))}
    </div>
  );
}
