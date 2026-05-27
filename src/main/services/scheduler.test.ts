import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the database and other native-dependent modules so we can import
// the scheduler without loading better-sqlite3.
vi.mock('../database', () => ({
  getDueSkills: vi.fn(() => []),
  getScheduledSkillsNeedingNextRun: vi.fn(() => []),
  claimSkillRun: vi.fn(() => true),
  updateSkillSchedule: vi.fn(),
  getSkill: vi.fn(),
  createSpace: vi.fn(),
  assignSpaceFolder: vi.fn(),
  isInitialized: vi.fn(() => false),
}));

vi.mock('../config', () => ({
  getConfigValue: vi.fn(() => null),
}));

vi.mock('../workspace', () => ({
  createSpaceFolder: vi.fn(),
  scheduleAutoCommit: vi.fn(),
}));

vi.mock('../frontmatter', () => ({
  serializeFrontmatter: vi.fn((_fm: unknown, body: string) => body),
}));

vi.mock('../notify', () => ({
  notifyAllWindows: vi.fn(),
}));

import { computeNextRunAt } from './scheduler';

/**
 * Tests for the pure schedule-computation function. The async tick loop
 * (checkAndRunDueSkills) is harder to exercise without a real DB; we rely on
 * integration testing for that path.
 */
describe('computeNextRunAt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('daily', () => {
    it('schedules for later today if time has not yet passed', () => {
      // Monday 2024-01-15 at 08:00 local
      vi.setSystemTime(new Date(2024, 0, 15, 8, 0, 0));
      const next = new Date(computeNextRunAt('daily', '17:00', null));
      expect(next.getFullYear()).toBe(2024);
      expect(next.getMonth()).toBe(0);
      expect(next.getDate()).toBe(15);
      expect(next.getHours()).toBe(17);
    });

    it('schedules for tomorrow if time has already passed today', () => {
      // Monday 2024-01-15 at 18:00 local
      vi.setSystemTime(new Date(2024, 0, 15, 18, 0, 0));
      const next = new Date(computeNextRunAt('daily', '09:00', null));
      expect(next.getDate()).toBe(16);
      expect(next.getHours()).toBe(9);
    });
  });

  describe('weekdays', () => {
    it('skips Saturday to Monday', () => {
      // Friday 2024-01-12 at 18:00 → next weekday is Monday Jan 15
      vi.setSystemTime(new Date(2024, 0, 12, 18, 0, 0));
      const next = new Date(computeNextRunAt('weekdays', '09:00', null));
      expect(next.getDay()).toBe(1); // Monday
      expect(next.getDate()).toBe(15);
    });

    it('runs the same day if before time on a weekday', () => {
      // Wednesday 2024-01-17 at 08:00
      vi.setSystemTime(new Date(2024, 0, 17, 8, 0, 0));
      const next = new Date(computeNextRunAt('weekdays', '09:00', null));
      expect(next.getDate()).toBe(17);
      expect(next.getHours()).toBe(9);
    });
  });

  describe('weekly', () => {
    it('lands on the requested day of week', () => {
      // Wednesday 2024-01-17 at 10:00, schedule for Tuesday (day=2)
      vi.setSystemTime(new Date(2024, 0, 17, 10, 0, 0));
      const next = new Date(computeNextRunAt('weekly', '09:00', 2));
      expect(next.getDay()).toBe(2); // Tuesday
      // Next Tuesday is Jan 23
      expect(next.getDate()).toBe(23);
    });

    it('defaults to Monday when day is null', () => {
      // Wednesday 2024-01-17
      vi.setSystemTime(new Date(2024, 0, 17, 10, 0, 0));
      const next = new Date(computeNextRunAt('weekly', '09:00', null));
      expect(next.getDay()).toBe(1); // Monday
    });
  });

  describe('biweekly', () => {
    it('produces a date at least 7 days in the future', () => {
      // Monday 2024-01-15 at 10:00, schedule for Tuesday (day=2)
      vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0));
      const next = new Date(computeNextRunAt('biweekly', '09:00', 2));
      const diffMs = next.getTime() - Date.now();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(7);
      expect(next.getDay()).toBe(2); // Tuesday
    });
  });

  describe('monthly', () => {
    it('schedules for next month if time has passed today', () => {
      // Jan 15 at 18:00 → Feb 15 at 09:00
      vi.setSystemTime(new Date(2024, 0, 15, 18, 0, 0));
      const next = new Date(computeNextRunAt('monthly', '09:00', null));
      expect(next.getMonth()).toBe(1); // Feb
      expect(next.getDate()).toBe(15);
    });

    it('clamps to last day of month when target day overshoots (Jan 31 → Feb 29 in leap year)', () => {
      // Jan 31 2024 (leap year) at 18:00 → should be Feb 29 (not Mar 2)
      vi.setSystemTime(new Date(2024, 0, 31, 18, 0, 0));
      const next = new Date(computeNextRunAt('monthly', '09:00', null));
      expect(next.getMonth()).toBe(1); // Feb (not Mar!)
      expect(next.getDate()).toBe(29); // last day of Feb in 2024
      expect(next.getHours()).toBe(9);
    });

    it('clamps to last day of month when target day overshoots (Jan 31 → Feb 28 in non-leap year)', () => {
      // Jan 31 2023 at 18:00 → should be Feb 28
      vi.setSystemTime(new Date(2023, 0, 31, 18, 0, 0));
      const next = new Date(computeNextRunAt('monthly', '09:00', null));
      expect(next.getMonth()).toBe(1); // Feb
      expect(next.getDate()).toBe(28);
    });
  });

  describe('return value', () => {
    it('returns a valid ISO 8601 UTC string', () => {
      vi.setSystemTime(new Date(2024, 0, 15, 8, 0, 0));
      const result = computeNextRunAt('daily', '09:00', null);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // Should be parseable back to a Date
      expect(new Date(result).toString()).not.toBe('Invalid Date');
    });
  });
});
