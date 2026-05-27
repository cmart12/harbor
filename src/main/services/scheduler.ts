import { getDueSkills, markSkillRun, getSkill, createSpace, assignSpaceFolder } from '../database';
import { getConfigValue } from '../config';
import { createSpaceFolder, scheduleAutoCommit } from '../workspace';
import { serializeFrontmatter } from '../frontmatter';
import { notifyAllWindows } from '../notify';
import { isInitialized } from '../database';
import * as fs from 'fs';
import * as path from 'path';
import type { SkillScheduleFrequency } from '../../shared/types';

const CHECK_INTERVAL_MS = 60_000; // Check every 60 seconds
let intervalId: ReturnType<typeof setInterval> | null = null;

/** Start the skill scheduler — checks for due skills every 60s. */
export function startScheduler(): void {
  stopScheduler();
  // Run immediately on startup to catch up on missed runs
  checkAndRunDueSkills();
  intervalId = setInterval(checkAndRunDueSkills, CHECK_INTERVAL_MS);
  console.log('[scheduler] Started skill scheduler');
}

/** Stop the skill scheduler. */
export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/** Check for due skills and launch them. */
async function checkAndRunDueSkills(): Promise<void> {
  if (!isInitialized()) return;

  const now = new Date().toISOString();
  const dueSkills = getDueSkills(now);

  for (const skill of dueSkills) {
    try {
      console.log(`[scheduler] Triggering scheduled skill: ${skill.name} (${skill.id})`);
      await launchSkillForSchedule(skill.id);

      const nextRun = computeNextRunAt(
        skill.schedule!,
        skill.schedule_time || '09:00',
        skill.schedule_day
      );
      markSkillRun(skill.id, now, nextRun);
      notifyAllWindows('skills:changed');
      console.log(`[scheduler] Next run for ${skill.id}: ${nextRun}`);
    } catch (err) {
      console.error(`[scheduler] Failed to launch skill ${skill.id}:`, err);
    }
  }
}

/** Launch a skill as a new space (shared logic used by both scheduler and IPC handler). */
export async function launchSkillForSchedule(skillId: string): Promise<void> {
  const workspace = getConfigValue('workspace');
  if (!workspace || !isInitialized()) return;

  const skill = getSkill(skillId);
  if (!skill) return;

  const space = createSpace({ body: skill.name }, skillId);

  const folder = createSpaceFolder(workspace, space.id, skill.name);
  assignSpaceFolder(space.id, folder);
  space.folder = folder;

  const canvasBody = `# ${skill.name}\n`;
  const canvasContent = serializeFrontmatter({ skills: [skillId] }, canvasBody);
  const canvasMdPath = path.join(workspace, folder, 'canvas.md');
  fs.writeFileSync(canvasMdPath, canvasContent, 'utf-8');

  scheduleAutoCommit(workspace);

  const { launchSession } = await import('../session');
  launchSession(space.id, workspace);
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

    case 'monthly':
      // Same day of month, next month if past
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
      }
      break;
  }

  return next.toISOString();
}
