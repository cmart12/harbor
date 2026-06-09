import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Rect } from './geometry';
import { useAnchoredPosition } from './floating';

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
  // Anchored just below the caret, flipped above + clamped to stay on screen.
  const { ref, style } = useAnchoredPosition(rect, { placement: 'below', align: 'start', gap: 4 });

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [ref, activeIndex]);

  if (candidates.length === 0) return null;

  const popup = (
    <div className="md-mention-popup" style={style} ref={ref} onMouseDown={(e) => e.preventDefault()}>
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

  return typeof document === 'undefined' ? popup : createPortal(popup, document.body);
}
