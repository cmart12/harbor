import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SpaceEvent } from '../../shared/ipc-contract';
import { historyStore } from './history-store';

function makeEvent(overrides: Partial<SpaceEvent> & { id: string; space_id: string; event_type: string }): SpaceEvent {
  return {
    due_at: null,
    due_at_utc: null,
    completed_at: null,
    recurrence_json: null,
    created_at: '2024-01-01T00:00:00Z',
    space_description: null,
    space_client: null,
    session_id: null,
    ...overrides,
  };
}

describe('HistoryStore', () => {
  beforeEach(() => {
    historyStore.setEvents([]);
  });

  it('has correct initial state after reset', () => {
    expect(historyStore.getState().events).toEqual([]);
  });

  it('setEvents() updates events and notifies listeners', () => {
    const listener = vi.fn();
    const unsub = historyStore.subscribe(listener);

    const events = [makeEvent({ id: 'e1', space_id: 's1', event_type: 'completed' })];
    historyStore.setEvents(events);

    expect(historyStore.getState().events).toEqual(events);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('subscribe returns a working unsubscribe function', () => {
    const listener = vi.fn();
    const unsub = historyStore.subscribe(listener);

    historyStore.setEvents([makeEvent({ id: 'e1', space_id: 's1', event_type: 'completed' })]);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    historyStore.setEvents([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // -- Stale-fetch guards -----------------------------------------------------

  it('nextRequestId() returns monotonically increasing ids', () => {
    const id1 = historyStore.nextRequestId();
    const id2 = historyStore.nextRequestId();
    expect(id2).toBeGreaterThan(id1);
  });

  it('isCurrentRequest() recognizes only the latest reservation', () => {
    const stale = historyStore.nextRequestId();
    const fresh = historyStore.nextRequestId();

    expect(historyStore.isCurrentRequest(fresh)).toBe(true);
    expect(historyStore.isCurrentRequest(stale)).toBe(false);
  });

  // -- getEventsBySpace() -----------------------------------------------------

  it('getEventsBySpace() groups events by space_id', () => {
    const e1 = makeEvent({ id: 'e1', space_id: 's1', event_type: 'completed' });
    const e2 = makeEvent({ id: 'e2', space_id: 's1', event_type: 'recycled' });
    const e3 = makeEvent({ id: 'e3', space_id: 's2', event_type: 'completed' });
    historyStore.setEvents([e1, e2, e3]);

    const groups = historyStore.getEventsBySpace();
    expect(groups.get('s1')).toEqual([e1, e2]);
    expect(groups.get('s2')).toEqual([e3]);
  });

  it('getEventsBySpace() skips events with empty space_id', () => {
    const e1 = makeEvent({ id: 'e1', space_id: '', event_type: 'completed' });
    const e2 = makeEvent({ id: 'e2', space_id: 's1', event_type: 'completed' });
    historyStore.setEvents([e1, e2]);

    const groups = historyStore.getEventsBySpace();
    expect(groups.has('')).toBe(false);
    expect(groups.get('s1')).toEqual([e2]);
  });
});
