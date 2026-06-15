/**
 * Snooze preset math — pure function ported verbatim from Funnel's
 * `src-tauri/src/notif_actions.rs::compute_snooze_until`.
 *
 * Returns a UTC RFC3339 string (the timestamp stored in
 * `notifications.snoozed_until`). The math runs in LOCAL time so
 * "tomorrow 9am" and "next Monday 9am" feel right to the user, then
 * converts to UTC for storage.
 *
 * Pure (preset, now) → string so the 8 unit cases stay trivial.
 */

import type { SnoozePreset } from '../shared/notification-types';

export function computeSnoozeUntil(preset: SnoozePreset, now: Date = new Date()): string {
  switch (preset) {
    case '1h':
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    case '3h':
      return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
    case 'tomorrow_9am': {
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
      return tomorrow.toISOString();
    }
    case 'next_monday_9am': {
      const target = nextMondayDate(now);
      const dt = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 9, 0, 0, 0);
      return dt.toISOString();
    }
    default: {
      // Exhaustiveness check at compile time, defensive runtime error.
      const _exhaustive: never = preset;
      throw new Error(`unknown snooze preset: ${String(_exhaustive)}`);
    }
  }
}

/**
 * "Next Monday" semantics matching Funnel:
 *  - If today is Monday AND it's currently before 9am local, that's today.
 *  - Otherwise the upcoming Monday (Tue → +6 days, Mon after 9am → +7 days, ...).
 *
 * Uses local-time `getDay()` so the user sees Monday-in-their-timezone, not
 * Monday-UTC.
 */
function nextMondayDate(now: Date): Date {
  const dayOfWeek = now.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (dayOfWeek === 1) {
    // Monday — keep today only if we're still before 9am.
    const nineAmToday = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0,
    );
    if (now.getTime() < nineAmToday.getTime()) return today;
    // After 9am Monday: jump 7 days forward.
    const result = new Date(today);
    result.setDate(result.getDate() + 7);
    return result;
  }

  // Days until next Monday: (1 - dayOfWeek + 7) % 7, treating 0 as 7.
  let daysUntilMonday = (1 - dayOfWeek + 7) % 7;
  if (daysUntilMonday === 0) daysUntilMonday = 7;
  const result = new Date(today);
  result.setDate(result.getDate() + daysUntilMonday);
  return result;
}
