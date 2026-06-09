import { describe, it, expect } from 'vitest';
import { computeAnchoredPosition } from './floating';
import type { Rect } from './geometry';

function rect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

const VP = { width: 1000, height: 800 };
const SIZE = { width: 200, height: 100 };

describe('computeAnchoredPosition', () => {
  it('centers a toolbar above the selection when there is room', () => {
    const anchor = rect(400, 400, 120, 20); // center x = 460
    const { left, top } = computeAnchoredPosition(anchor, SIZE, VP, { placement: 'above', align: 'center' });
    expect(left).toBe(360); // 460 - 200/2
    expect(top).toBe(292); // 400 - 8(gap) - 100
  });

  it('clamps the left edge on screen when selecting near the left border', () => {
    // Selecting the beginning of a line: anchor at far left.
    const anchor = rect(2, 400, 60, 20);
    const { left } = computeAnchoredPosition(anchor, SIZE, VP, { placement: 'above', align: 'center' });
    expect(left).toBe(8); // clamped to MARGIN, never negative / off-screen
  });

  it('clamps the right edge on screen when selecting near the right border', () => {
    const anchor = rect(980, 400, 18, 20);
    const { left } = computeAnchoredPosition(anchor, SIZE, VP, { placement: 'above', align: 'center' });
    expect(left).toBe(VP.width - SIZE.width - 8); // 792
  });

  it('flips a top-anchored toolbar below when there is no room above', () => {
    const anchor = rect(400, 30, 120, 20); // only 30px above — toolbar (100) won\'t fit
    const { top } = computeAnchoredPosition(anchor, SIZE, VP, { placement: 'above', align: 'center' });
    expect(top).toBe(58); // flipped: anchor.bottom(50) + 8
  });

  it('flips a below-anchored popover above when it would overflow the bottom', () => {
    const anchor = rect(100, 760, 120, 20); // bottom = 780, popover(100) overflows 800
    const { top } = computeAnchoredPosition(anchor, SIZE, VP, { placement: 'below', align: 'start', gap: 6 });
    expect(top).toBe(654); // flipped above: anchor.top(760) - 6 - 100
  });

  it('left-aligns a popover to the selection start and clamps within the viewport', () => {
    const anchor = rect(950, 300, 40, 20); // start near right edge
    const { left } = computeAnchoredPosition(anchor, SIZE, VP, { placement: 'below', align: 'start' });
    expect(left).toBe(792); // clamped to vw - width - margin
  });

  it('keeps a huge multi-line selection box centered and on screen', () => {
    // Full-width multi-line selection (the reported "nothing shows" case).
    const anchor = rect(30, 360, 1900, 190);
    const { left, top } = computeAnchoredPosition({ ...anchor, right: 30 + 1900, bottom: 360 + 190 }, SIZE, { width: 2000, height: 1000 }, { placement: 'above', align: 'center' });
    expect(left).toBe(880); // (30 + 1900/2) - 100
    expect(top).toBe(252); // 360 - 8 - 100, on screen
  });
});
