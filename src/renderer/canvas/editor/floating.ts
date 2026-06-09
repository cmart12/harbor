import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Rect } from './geometry';

const MARGIN = 8;
const Z_INDEX = 2147483000;

export type Placement = 'above' | 'below';
export type Align = 'center' | 'start';

export interface AnchoredOptions {
  placement: Placement;
  align: Align;
  gap?: number;
}

interface Size { width: number; height: number; }
interface Viewport { width: number; height: number; }

/**
 * Pure placement math: given the anchor rect, the floating element's measured
 * size, and the viewport, return a left/top that keeps the element fully on
 * screen — flipping to the opposite side when it won't fit and clamping to the
 * viewport with a margin on both axes.
 */
export function computeAnchoredPosition(
  anchor: Rect,
  size: Size,
  viewport: Viewport,
  opts: AnchoredOptions,
): { left: number; top: number } {
  const gap = opts.gap ?? 8;
  const { width, height } = size;
  const { width: vw, height: vh } = viewport;

  let left = opts.align === 'center' ? anchor.left + anchor.width / 2 - width / 2 : anchor.left;
  left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));

  let top: number;
  if (opts.placement === 'above') {
    top = anchor.top - gap - height;
    if (top < MARGIN) top = anchor.bottom + gap; // flip below
  } else {
    top = anchor.bottom + gap;
    if (top + height > vh - MARGIN) top = anchor.top - gap - height; // flip above
  }
  top = Math.max(MARGIN, Math.min(top, vh - height - MARGIN));

  return { left: Math.round(left), top: Math.round(top) };
}

/**
 * Position a floating element relative to an anchor rect (viewport coords),
 * measuring the element after render so it can be kept **fully on screen**:
 * it flips to the opposite side when there's no room, and clamps to the
 * viewport on both axes. Returns a ref to attach to the floating element and
 * the computed fixed-position style.
 */
export function useAnchoredPosition(anchor: Rect, opts: AnchoredOptions) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({
    position: 'fixed',
    left: 0,
    top: 0,
    zIndex: Z_INDEX,
    // Hidden until measured, so it never flashes at the wrong spot.
    visibility: 'hidden',
  });

  const gap = opts.gap ?? 8;
  const { placement, align } = opts;
  const { left: aLeft, top: aTop, width: aWidth, height: aHeight, right: aRight, bottom: aBottom } = anchor;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const compute = () => {
      const { width, height } = el.getBoundingClientRect();
      const { left, top } = computeAnchoredPosition(
        { left: aLeft, top: aTop, width: aWidth, height: aHeight, right: aRight, bottom: aBottom },
        { width, height },
        { width: window.innerWidth, height: window.innerHeight },
        { placement, align, gap },
      );
      setStyle({ position: 'fixed', left, top, zIndex: Z_INDEX, visibility: 'visible' });
    };

    compute();

    // Re-clamp when the element resizes (e.g. a reply box grows) or the window
    // resizes, so it can never drift off screen.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => compute()) : null;
    ro?.observe(el);
    window.addEventListener('resize', compute);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [aLeft, aTop, aWidth, aHeight, aRight, aBottom, placement, align, gap]);

  return { ref, style };
}
