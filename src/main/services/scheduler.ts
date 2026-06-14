import {
  getDueSkills,
  getScheduledSkillsNeedingNextRun,
  claimSkillRun,
  updateSkillSchedule,
} from '../database';
import { getConfigValue } from '../config';
import { notifyAllWindows } from '../notify';
import { isInitialized } from '../database';
import { invokeSkill } from '../skill-invocation';
import type { SkillScheduleFrequency } from '../../shared/types';

const CHECK_INTERVAL_MS = 60_000; // Check every 60 seconds
let intervalId: ReturnType<typeof setInterval> | null = null;
let isChecking = false; // Reentrancy guard — prevents overlapping ticks

/** Start the skill scheduler — checks for due skills every 60s. */
export function startScheduler(): void {
  stopScheduler();
  // Recover schedules from disk on startup (DB is rebuilt each launch, so
  // next_run_at is null after skill-watcher sync) and catch up any due runs.
  void recoverSchedulesAndTick();
  intervalId = setInterval(() => { void checkAndRunDueSkills(); }, CHECK_INTERVAL_MS);
  console.log('[scheduler] Started skill scheduler');
}

/** Stop the skill scheduler. */
export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * On startup, compute next_run_at for any scheduled skill that doesn't have one
 * (this happens because the DB is rebuilt from event log on each launch, while
 * schedule frontmatter is on disk). Then run a normal due-check.
 */
async function recoverSchedulesAndTick(): Promise<void> {
  if (!isInitialized()) return;

  try {
    const needsRecovery = getScheduledSkillsNeedingNextRun();
    for (const skill of needsRecovery) {
      if (!skill.schedule) continue;
      const nextRun = computeNextRunAt(
        skill.schedule,
        skill.schedule_time || '09:00',
        skill.schedule_day
      );
      updateSkillSchedule(skill.id, skill.schedule, skill.schedule_time, skill.schedule_day, nextRun);
      console.log(`[scheduler] Recovered schedule for ${skill.id}: next run ${nextRun}`);
    }
    if (needsRecovery.length > 0) notifyAllWindows('skills:changed');
  } catch (err) {
    console.error('[scheduler] Failed to recover schedules:', err);
  }

  await checkAndRunDueSkills();
}

/** Check for due skills and launch them. */
async function checkAndRunDueSkills(): Promise<void> {
  if (!isInitialized()) return;
  if (isChecking) {
    // Previous tick still in flight — skip this one to avoid duplicate launches.
    return;
  }
  isChecking = true;

  try {
    const now = new Date().toISOString();
    const dueSkills = getDueSkills(now);

    for (const skill of dueSkills) {
      if (!skill.schedule || !skill.next_run_at) continue;

      const previousNextRun = skill.next_run_at;
      const nextRun = computeNextRunAt(
        skill.schedule,
        skill.schedule_time || '09:00',
        skill.schedule_day
      );

      // Atomically claim this run by CAS-advancing next_run_at. If another
      // tick already grabbed it, claimed will be false and we skip the launch.
      const claimed = claimSkillRun(skill.id, previousNextRun, now, nextRun);
      if (!claimed) {
        console.log(`[scheduler] Skipped ${skill.id} — already claimed by another tick`);
        continue;
      }

      console.log(`[scheduler] Triggering scheduled skill: ${skill.name} (${skill.id})`);
      notifyAllWindows('skills:changed');

      try {
        const result = await launchSkillForSchedule(skill.id);
        if (!result.success) {
          console.error(`[scheduler] Launch failed for ${skill.id}: ${result.error}`);
        } else {
          console.log(`[scheduler] Next run for ${skill.id}: ${nextRun}`);
        }
      } catch (err) {
        // Launch errored — DB has already been advanced, so we won't retry until
        // the next scheduled tick. This is intentional: better than infinite retry.
        console.error(`[scheduler] Launch error for ${skill.id}:`, err);
      }
    }
  } finally {
    isChecking = false;
  }
}

/** Launch a skill as a new space. Returns launch success/failure. */
export async function launchSkillForSchedule(skillId: string): Promise<{ success: boolean; error?: string }> {
  const workspace = getConfigValue('workspace');
  if (!workspace || !isInitialized()) return { success: false, error: 'no_workspace' };

  const result = await invokeSkill({ skillId, run: true, source: 'schedule' });
  if ('space' in result && !result.error) return { success: true };
  return { success: false, error: result.error || 'launch_failed' };
}

/**
 * Compute the next run time in UTC ISO 8601 based on frequency, time-of-day, and day-of-week.
 * All times are relative to the local timezone.
 */
export function computeNextRunAt(
  frequency: SkillScheduleFrequency,
  time: string,
  day: number | null
): string {
  const [hours, minutes] = time.split(':').map(Number);
  const now = new Date();

  // Start from "today at the scheduled time"
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);

  switch (frequency) {
    case 'daily':
      // If already past today's time, schedule for tomorrow
      if (next <= now) next.setDate(next.getDate() + 1);
      break;

    case 'weekdays':
      // If already past today's time, move to tomorrow
      if (next <= now) next.setDate(next.getDate() + 1);
      // Skip weekends
      while (next.getDay() === 0 || next.getDay() === 6) {
        next.setDate(next.getDate() + 1);
      }
      break;

    case 'weekly': {
      const targetDay = day ?? 1; // Default to Monday
      // Move to next occurrence of the target day
      if (next <= now) next.setDate(next.getDate() + 1);
      while (next.getDay() !== targetDay) {
        next.setDate(next.getDate() + 1);
      }
      break;
    }

    case 'biweekly': {
      const targetDay2 = day ?? 1;
      if (next <= now) next.setDate(next.getDate() + 1);
      while (next.getDay() !== targetDay2) {
        next.setDate(next.getDate() + 1);
      }
      // If less than 7 days from now, push another week
      const diffDays = (next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays < 7) {
        next.setDate(next.getDate() + 7);
      }
      break;
    }

    case 'monthly': {
      // Same day of month, next month if past. Clamp to last day if month
      // doesn't have the target day (e.g. Jan 31 → Feb 28).
      const targetDayOfMonth = now.getDate();
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
      }
      // If JS rolled over (e.g. Feb 30 → Mar 2), clamp to last day of the
      // intended month.
      if (next.getDate() !== targetDayOfMonth) {
        // Go back to day 0 of the next month = last day of intended month
        next.setDate(0);
        next.setHours(hours, minutes, 0, 0);
      }
      break;
    }
  }

  return next.toISOString();
}
