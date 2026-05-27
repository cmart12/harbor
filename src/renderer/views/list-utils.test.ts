import { describe, it, expect, vi } from 'vitest';
import {
  timeAgo,
  formatDueDate,
  basename,
  humanizeToolName,
  describeApproval,
} from './list-utils';

describe('list-utils', () => {
  describe('timeAgo', () => {
    it('returns "just now" for very recent timestamps', () => {
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);
      expect(timeAgo('2024-01-01T12:00:00Z')).toBe('just now');
      expect(timeAgo('2024-01-01T11:59:30Z')).toBe('just now');
      vi.useRealTimers();
    });

    it('returns minutes for sub-hour deltas', () => {
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);
      expect(timeAgo('2024-01-01T11:55:00Z')).toBe('5m ago');
      expect(timeAgo('2024-01-01T11:01:00Z')).toBe('59m ago');
      vi.useRealTimers();
    });

    it('returns hours for sub-day deltas', () => {
      const now = new Date('2024-01-01T12:00:00Z');
      vi.setSystemTime(now);
      expect(timeAgo('2024-01-01T08:00:00Z')).toBe('4h ago');
      vi.useRealTimers();
    });

    it('returns days for multi-day deltas', () => {
      const now = new Date('2024-01-10T12:00:00Z');
      vi.setSystemTime(now);
      expect(timeAgo('2024-01-07T12:00:00Z')).toBe('3d ago');
      vi.useRealTimers();
    });
  });

  describe('formatDueDate', () => {
    it('returns empty when no due dates', () => {
      expect(formatDueDate(null, null)).toEqual({ text: '', overdue: false });
    });

    it('returns raw due_at text when no due_at_utc', () => {
      expect(formatDueDate(null, 'sometime')).toEqual({ text: 'sometime', overdue: false });
    });

    it('formats due today when exactly now', () => {
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
      expect(formatDueDate('2024-01-01T12:00:00Z', null)).toEqual({ text: 'due today', overdue: false });
      vi.useRealTimers();
    });

    it('formats overdue', () => {
      vi.setSystemTime(new Date('2024-01-05T12:00:00Z'));
      expect(formatDueDate('2024-01-03T12:00:00Z', null)).toEqual({ text: '2d overdue', overdue: true });
      vi.useRealTimers();
    });

    it('formats tomorrow', () => {
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
      expect(formatDueDate('2024-01-02T12:00:00Z', null)).toEqual({ text: 'tomorrow', overdue: false });
      vi.useRealTimers();
    });

    it('formats near-future days', () => {
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
      expect(formatDueDate('2024-01-04T12:00:00Z', null)).toEqual({ text: 'in 3d', overdue: false });
      vi.useRealTimers();
    });

    it('formats far-future as date', () => {
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
      const result = formatDueDate('2024-02-15T12:00:00Z', null);
      expect(result.overdue).toBe(false);
      expect(result.text).toMatch(/Feb/);
    });
  });

  describe('basename', () => {
    it('returns last segment of a unix path', () => {
      expect(basename('/foo/bar/baz.txt')).toBe('baz.txt');
    });
    it('returns last segment of a windows path', () => {
      expect(basename('C:\\foo\\bar\\baz.txt')).toBe('baz.txt');
    });
    it('returns input when no separators', () => {
      expect(basename('plain')).toBe('plain');
    });
  });

  describe('humanizeToolName', () => {
    it('returns intent text for report_intent', () => {
      expect(humanizeToolName('report_intent', { intent: 'Doing something' })).toBe('Doing something');
    });

    it('truncates long bash commands', () => {
      const long = 'a'.repeat(100);
      const result = humanizeToolName('bash', { command: long });
      expect(result.length).toBeLessThanOrEqual(81); // 77 + '…'
      expect(result.endsWith('…')).toBe(true);
    });

    it('formats edit with filename', () => {
      expect(humanizeToolName('edit', { path: '/a/b/file.ts' })).toBe('Editing file.ts');
    });

    it('falls back to label map', () => {
      expect(humanizeToolName('grep')).toBe('Searching code');
    });

    it('falls back to titlecased name', () => {
      expect(humanizeToolName('my_custom_tool')).toBe('My Custom Tool');
    });
  });

  describe('describeApproval', () => {
    it('describes file writes', () => {
      const r = describeApproval({ permissionKind: 'file_write', path: '/etc/c' });
      expect(r.label).toBe('Write to files');
      expect(r.detail).toBe('/etc/c');
    });

    it('describes bash commands', () => {
      const r = describeApproval({ permissionKind: 'bash_exec' });
      expect(r.label).toBe('Execute a command');
    });

    // Note: preserves legacy app.ts behavior where `file_read` matches the
    // 'file' branch first → "Write to files". Surgical migration intentionally
    // keeps this; relabeling is out of scope.
    it('treats file_read as a file-class permission (legacy parity)', () => {
      const r = describeApproval({ permissionKind: 'file_read', path: '/a/b/c/d/e/f.txt' });
      expect(r.label).toBe('Write to files');
      expect(r.detail).toBe('…/d/e/f.txt');
    });

    it('describes a non-file read kind as "Read files"', () => {
      const r = describeApproval({ permissionKind: 'read_path', path: '/a/b/c/d/e/f.txt' });
      expect(r.label).toBe('Read files');
      expect(r.detail).toBe('…/d/e/f.txt');
    });

    it('falls back to underscored kind', () => {
      const r = describeApproval({ permissionKind: 'something_else' });
      expect(r.label).toBe('something else');
    });

    it('uses intention when no path', () => {
      const r = describeApproval({ permissionKind: 'x', intention: 'Read the README' });
      expect(r.detail).toBe('Read the README');
    });
  });
});
