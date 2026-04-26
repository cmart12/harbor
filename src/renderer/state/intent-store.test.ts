import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Intent } from '../../shared/types';

// The module exports only a singleton; we re-import to get a fresh reference
// but must reset state between tests since it's shared.
import { intentStore } from './intent-store';
import type { IntentFilter } from './intent-store';

function makeIntent(overrides: Partial<Intent> & { id: string }): Intent {
  return {
    description: 'Test intent',
    body: null,
    raw_text: null,
    client: null,
    due_at: null,
    due_at_utc: null,
    recurrence: null,
    completed_at: null,
    folder: null,
    session_id: null,
    attachments: [],
    status: 'captured',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('IntentStore', () => {
  beforeEach(() => {
    // Reset singleton state between tests
    intentStore.setIntents([]);
    intentStore.setFilter('open');
    intentStore.setSearchResults(null);
    intentStore.setFocusedIntent(null);
    intentStore.setCanvasIntent(null);
  });

  // -- Initial state ----------------------------------------------------------

  it('has correct initial state after reset', () => {
    const state = intentStore.getState();
    expect(state.intents).toEqual([]);
    expect(state.filter).toBe('open');
    expect(state.searchResults).toBeNull();
    expect(state.focusedIntentId).toBeNull();
    expect(state.canvasIntentId).toBeNull();
  });

  // -- Setters ----------------------------------------------------------------

  it('setIntents() updates intents and notifies listeners', () => {
    const listener = vi.fn();
    const unsub = intentStore.subscribe(listener);

    const intents = [makeIntent({ id: '1' }), makeIntent({ id: '2' })];
    intentStore.setIntents(intents);

    expect(intentStore.getState().intents).toEqual(intents);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('setFilter() updates the filter', () => {
    intentStore.setFilter('closed');
    expect(intentStore.getState().filter).toBe('closed');
  });

  it('setSearchResults() updates search results', () => {
    const results = [makeIntent({ id: 'sr1' })];
    intentStore.setSearchResults(results);
    expect(intentStore.getState().searchResults).toEqual(results);

    intentStore.setSearchResults(null);
    expect(intentStore.getState().searchResults).toBeNull();
  });

  it('setFocusedIntent() updates the focused intent id', () => {
    intentStore.setFocusedIntent('abc');
    expect(intentStore.getState().focusedIntentId).toBe('abc');

    intentStore.setFocusedIntent(null);
    expect(intentStore.getState().focusedIntentId).toBeNull();
  });

  it('setCanvasIntent() updates the canvas intent id', () => {
    intentStore.setCanvasIntent('xyz');
    expect(intentStore.getState().canvasIntentId).toBe('xyz');

    intentStore.setCanvasIntent(null);
    expect(intentStore.getState().canvasIntentId).toBeNull();
  });

  // -- Subscribe / unsubscribe ------------------------------------------------

  it('subscribe() returns a working unsubscribe function', () => {
    const listener = vi.fn();
    const unsub = intentStore.subscribe(listener);

    intentStore.setFilter('closed');
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    intentStore.setFilter('agents');
    expect(listener).toHaveBeenCalledTimes(1); // not called again
  });

  it('multiple listeners are all notified', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = intentStore.subscribe(listener1);
    const unsub2 = intentStore.subscribe(listener2);

    intentStore.setFilter('agents');

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });

  // -- getFilteredIntents() ---------------------------------------------------

  describe('getFilteredIntents()', () => {
    const captured = makeIntent({ id: '1', status: 'captured' });
    const inProgress = makeIntent({ id: '2', status: 'in_progress' });
    const done = makeIntent({ id: '3', status: 'done' });

    beforeEach(() => {
      intentStore.setIntents([captured, inProgress, done]);
    });

    it('filter "open" returns intents that are not done', () => {
      intentStore.setFilter('open');
      const result = intentStore.getFilteredIntents();
      expect(result).toEqual([captured, inProgress]);
    });

    it('filter "closed" returns only done intents', () => {
      intentStore.setFilter('closed');
      const result = intentStore.getFilteredIntents();
      expect(result).toEqual([done]);
    });

    it('filter "agents" returns all intents', () => {
      intentStore.setFilter('agents');
      const result = intentStore.getFilteredIntents();
      expect(result).toEqual([captured, inProgress, done]);
    });

    it('returns searchResults when set, regardless of filter', () => {
      const searchHit = makeIntent({ id: 'search-1', status: 'done' });
      intentStore.setSearchResults([searchHit]);
      intentStore.setFilter('open');

      expect(intentStore.getFilteredIntents()).toEqual([searchHit]);
    });
  });

  // -- getIntent() ------------------------------------------------------------

  it('getIntent() returns the intent by id', () => {
    const intent = makeIntent({ id: 'find-me' });
    intentStore.setIntents([makeIntent({ id: 'other' }), intent]);
    expect(intentStore.getIntent('find-me')).toEqual(intent);
  });

  it('getIntent() returns undefined for unknown id', () => {
    intentStore.setIntents([makeIntent({ id: 'x' })]);
    expect(intentStore.getIntent('nope')).toBeUndefined();
  });

  // -- Readonly state ---------------------------------------------------------

  it('getState() returns a Readonly snapshot', () => {
    intentStore.setIntents([makeIntent({ id: '1' })]);
    const state = intentStore.getState();

    // Subsequent mutations should produce a new state object
    intentStore.setFilter('closed');
    const state2 = intentStore.getState();
    expect(state).not.toBe(state2);
    // Original snapshot is unchanged
    expect(state.filter).toBe('open');
    expect(state2.filter).toBe('closed');
  });
});
