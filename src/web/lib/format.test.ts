import { describe, expect, it, vi, afterEach } from 'vitest';
import { describeApproval, formatDueDate, humanizeToolName, statusLabel, timeAgo } from './format';

afterEach(() => vi.useRealTimers());

describe('timeAgo', () => {
  it('formats recent and older times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    expect(timeAgo(new Date('2026-01-01T11:59:40Z').toISOString())).toBe('just now');
    expect(timeAgo(new Date('2026-01-01T11:30:00Z').toISOString())).toBe('30m ago');
    expect(timeAgo(new Date('2026-01-01T09:00:00Z').toISOString())).toBe('3h ago');
    expect(timeAgo(new Date('2025-12-30T12:00:00Z').toISOString())).toBe('2d ago');
  });
});

describe('formatDueDate', () => {
  it('flags overdue and upcoming', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
    expect(formatDueDate('2026-01-08T12:00:00Z', null)).toMatchObject({ overdue: true });
    expect(formatDueDate('2026-01-11T12:00:00Z', null)).toMatchObject({ overdue: false, text: 'tomorrow' });
  });

  it('falls back to plain text when no utc timestamp', () => {
    expect(formatDueDate(null, 'next week')).toEqual({ text: 'next week', overdue: false });
  });
});

describe('describeApproval', () => {
  it('labels write requests with a trimmed path', () => {
    const result = describeApproval({ permissionKind: 'file_write', path: '/a/b/c/d/e.ts' });
    expect(result.label).toBe('Write to files');
    expect(result.detail).toBe('…/c/d/e.ts');
  });
});

describe('humanizeToolName + statusLabel', () => {
  it('humanizes tools and statuses', () => {
    expect(humanizeToolName('bash', { command: 'ls -la' })).toBe('ls -la');
    expect(humanizeToolName('edit', { path: '/x/file.ts' })).toBe('Editing file.ts');
    expect(statusLabel('waiting-approval')).toBe('needs attention');
  });
});
