/**
 * Snooze preset math tests — ported verbatim from Funnel's
 * `notif_actions.rs` test module (8 cases).
 *
 * Comparisons run in local time so the tests behave the same whether
 * the dev box is in UTC, EST, or PST.
 */

import { describe, it, expect } from 'vitest';
import { computeSnoozeUntil } from './notif-snooze';

function local(y: number, m: number, d: number, h: number, mi: number): Date {
  return new Date(y, m - 1, d, h, mi, 0, 0);
}

describe('computeSnoozeUntil', () => {
  it('1h preset adds exactly one hour', () => {
    const now = local(2026, 6, 12, 14, 0);
    const got = new Date(computeSnoozeUntil('1h', now));
    expect(got.getTime() - now.getTime()).toBe(60 * 60 * 1000);
  });

  it('3h preset adds exactly three hours', () => {
    const now = local(2026, 6, 12, 14, 0);
    const got = new Date(computeSnoozeUntil('3h', now));
    expect(got.getTime() - now.getTime()).toBe(3 * 60 * 60 * 1000);
  });

  it('tomorrow_9am from Friday evening lands Saturday 9am', () => {
    const now = local(2026, 6, 12, 22, 30);
    const got = new Date(computeSnoozeUntil('tomorrow_9am', now));
    expect(got.getTime()).toBe(local(2026, 6, 13, 9, 0).getTime());
  });

  it('next_monday_9am from a Friday lands Monday 9am', () => {
    const now = local(2026, 6, 12, 22, 30); // Friday
    const got = new Date(computeSnoozeUntil('next_monday_9am', now));
    expect(got.getTime()).toBe(local(2026, 6, 15, 9, 0).getTime());
  });

  it('next_monday_9am from Monday before 9am stays today', () => {
    const now = local(2026, 6, 15, 7, 30); // Monday before 9am
    const got = new Date(computeSnoozeUntil('next_monday_9am', now));
    expect(got.getTime()).toBe(local(2026, 6, 15, 9, 0).getTime());
  });

  it('next_monday_9am from Monday after 9am jumps to next Monday', () => {
    const now = local(2026, 6, 15, 10, 0); // Monday after 9am
    const got = new Date(computeSnoozeUntil('next_monday_9am', now));
    expect(got.getTime()).toBe(local(2026, 6, 22, 9, 0).getTime());
  });

  it('next_monday_9am from Sunday evening lands Monday 9am', () => {
    const now = local(2026, 6, 14, 23, 0); // Sunday
    const got = new Date(computeSnoozeUntil('next_monday_9am', now));
    expect(got.getTime()).toBe(local(2026, 6, 15, 9, 0).getTime());
  });

  it('unknown preset throws', () => {
    const now = local(2026, 6, 12, 14, 0);
    expect(() => computeSnoozeUntil('forever' as never, now)).toThrow();
  });
});
