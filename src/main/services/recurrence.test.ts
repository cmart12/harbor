import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────
const { mockEvaluateRecurrence, mockUpdateIntentCAS, mockLogIntentEvent, mockNotifyAllWindows } = vi.hoisted(() => ({
  mockEvaluateRecurrence: vi.fn(),
  mockUpdateIntentCAS: vi.fn(),
  mockLogIntentEvent: vi.fn(),
  mockNotifyAllWindows: vi.fn(),
}));

vi.mock('../ai', () => ({
  evaluateRecurrence: mockEvaluateRecurrence,
}));

vi.mock('../database', () => ({
  updateIntentCAS: mockUpdateIntentCAS,
  logIntentEvent: mockLogIntentEvent,
}));

vi.mock('../notify', () => ({
  notifyAllWindows: mockNotifyAllWindows,
}));

import {
  handleRecurrence,
  applyRecurrence,
  dismissRecurrence,
  cancelPendingRecurrence,
  hasPendingRecurrence,
} from './recurrence';

const sampleIntent = {
  id: 'intent-1',
  description: 'Test intent',
  body: null,
  raw_text: 'Buy groceries every week',
  client: null,
  due_at: '2024-01-15',
  due_at_utc: '2024-01-15T00:00:00Z',
  recurrence: null,
  completed_at: '2024-01-15T12:00:00Z',
  folder: null,
  session_id: null,
  attachments: [],
  status: 'done' as const,
  created_at: '2024-01-01',
  updated_at: '2024-01-15',
};

describe('recurrence service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('handleRecurrence', () => {
    it('notifies renderer when should_recur is false', async () => {
      mockEvaluateRecurrence.mockResolvedValue({
        should_recur: false,
        reasoning: 'Not recurring',
        next_due: null,
        next_due_utc: null,
      });

      await handleRecurrence(sampleIntent, 'v1');

      expect(mockNotifyAllWindows).toHaveBeenCalledWith('intent:recurrence', 'intent-1', expect.objectContaining({
        should_recur: false,
      }));
    });

    it('sets a pending timer when should_recur is true', async () => {
      mockEvaluateRecurrence.mockResolvedValue({
        should_recur: true,
        reasoning: 'Weekly pattern',
        next_due: '2024-01-22',
        next_due_utc: '2024-01-22T00:00:00Z',
      });

      await handleRecurrence(sampleIntent, 'v1');

      expect(hasPendingRecurrence('intent-1')).toBe(true);
      expect(mockNotifyAllWindows).toHaveBeenCalledWith('intent:recurrence', 'intent-1', expect.objectContaining({
        should_recur: true,
      }));
    });

    it('applies recurrence after 5-second timer', async () => {
      mockEvaluateRecurrence.mockResolvedValue({
        should_recur: true,
        reasoning: 'Weekly pattern',
        next_due: '2024-01-22',
        next_due_utc: '2024-01-22T00:00:00Z',
      });
      mockUpdateIntentCAS.mockReturnValue(true);

      await handleRecurrence(sampleIntent, 'v1');

      // Timer hasn't fired yet
      expect(mockUpdateIntentCAS).not.toHaveBeenCalled();

      // Advance past the 5-second undo window
      vi.advanceTimersByTime(5000);

      expect(mockUpdateIntentCAS).toHaveBeenCalledWith('intent-1', 'v1', expect.objectContaining({
        status: 'captured',
        due_at: '2024-01-22',
        due_at_utc: '2024-01-22T00:00:00Z',
      }));
    });

    it('handles AI evaluation failure gracefully', async () => {
      mockEvaluateRecurrence.mockRejectedValue(new Error('AI error'));

      // Should not throw
      await handleRecurrence(sampleIntent, 'v1');

      expect(hasPendingRecurrence('intent-1')).toBe(false);
    });
  });

  describe('applyRecurrence', () => {
    it('updates intent via CAS and logs event on success', () => {
      mockUpdateIntentCAS.mockReturnValue(true);

      applyRecurrence('intent-1', 'v1', {
        should_recur: true,
        reasoning: 'Weekly',
        next_due: '2024-01-22',
        next_due_utc: '2024-01-22T00:00:00Z',
      });

      expect(mockUpdateIntentCAS).toHaveBeenCalledWith('intent-1', 'v1', expect.objectContaining({
        status: 'captured',
        due_at: '2024-01-22',
      }));
      expect(mockLogIntentEvent).toHaveBeenCalledWith('intent-1', 'recycled', expect.any(Object));
      expect(mockNotifyAllWindows).toHaveBeenCalledWith('intent:recurrence-applied', 'intent-1');
    });

    it('does not log event when CAS fails', () => {
      mockUpdateIntentCAS.mockReturnValue(false);

      applyRecurrence('intent-1', 'v1', {
        should_recur: true,
        reasoning: 'Weekly',
        next_due: '2024-01-22',
        next_due_utc: '2024-01-22T00:00:00Z',
      });

      expect(mockLogIntentEvent).not.toHaveBeenCalled();
      expect(mockNotifyAllWindows).not.toHaveBeenCalledWith('intent:recurrence-applied', 'intent-1');
    });
  });

  describe('dismissRecurrence', () => {
    it('clears pending timer and removes from map', async () => {
      mockEvaluateRecurrence.mockResolvedValue({
        should_recur: true,
        reasoning: 'Weekly',
        next_due: '2024-01-22',
        next_due_utc: '2024-01-22T00:00:00Z',
      });

      await handleRecurrence(sampleIntent, 'v1');
      expect(hasPendingRecurrence('intent-1')).toBe(true);

      dismissRecurrence('intent-1');

      expect(hasPendingRecurrence('intent-1')).toBe(false);
      expect(mockLogIntentEvent).toHaveBeenCalledWith('intent-1', 'recurrence_dismissed', expect.any(Object));

      // Timer should not fire after dismiss
      vi.advanceTimersByTime(5000);
      expect(mockUpdateIntentCAS).not.toHaveBeenCalled();
    });

    it('is a no-op for non-pending intent', () => {
      dismissRecurrence('unknown-intent');
      expect(mockLogIntentEvent).not.toHaveBeenCalled();
    });
  });

  describe('cancelPendingRecurrence', () => {
    it('cancels timer without logging event', async () => {
      mockEvaluateRecurrence.mockResolvedValue({
        should_recur: true,
        reasoning: 'Weekly',
        next_due: '2024-01-22',
        next_due_utc: '2024-01-22T00:00:00Z',
      });

      await handleRecurrence(sampleIntent, 'v1');
      expect(hasPendingRecurrence('intent-1')).toBe(true);

      cancelPendingRecurrence('intent-1');

      expect(hasPendingRecurrence('intent-1')).toBe(false);
      expect(mockLogIntentEvent).not.toHaveBeenCalled();
    });
  });

  describe('hasPendingRecurrence', () => {
    it('returns false when no pending recurrence', () => {
      expect(hasPendingRecurrence('nope')).toBe(false);
    });

    it('returns true when recurrence is pending', async () => {
      mockEvaluateRecurrence.mockResolvedValue({
        should_recur: true,
        reasoning: 'Weekly',
        next_due: '2024-01-22',
        next_due_utc: '2024-01-22T00:00:00Z',
      });

      await handleRecurrence(sampleIntent, 'v1');

      expect(hasPendingRecurrence('intent-1')).toBe(true);

      // Clean up
      cancelPendingRecurrence('intent-1');
    });
  });
});
