import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Space } from '../../shared/types';

// The module exports only a singleton; we re-import to get a fresh reference
// but must reset state between tests since it's shared.
import { spaceStore } from './space-store';
import type { SpaceFilter } from './space-store';

function makeSpace(overrides: Partial<Space> & { id: string }): Space {
  return {
    description: 'Test space',
    body: null,
    raw_text: null,
    client: null,
    due_at: null,
    due_at_utc: null,
    recurrence: null,
    completed_at: null,
    folder: null,
    session_id: null,
    source_skill_id: null,
    attachments: [],
    status: 'captured',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('SpaceStore', () => {
  beforeEach(() => {
    // Reset singleton state between tests
    spaceStore.setSpaces([]);
    spaceStore.setFilter('open');
    spaceStore.setSearchResults(null);
    spaceStore.setSearchMode(false);
    spaceStore.setActiveSearchQuery('');
    spaceStore.setFocusedSpace(null);
    spaceStore.setCanvasSpace(null);
    spaceStore.setSelectedIndex(-1);
    for (const id of spaceStore.getState().recallHints.keys()) {
      spaceStore.setRecallHint(id, null);
    }
  });

  // -- Initial state ----------------------------------------------------------

  it('has correct initial state after reset', () => {
    const state = spaceStore.getState();
    expect(state.spaces).toEqual([]);
    expect(state.filter).toBe('open');
    expect(state.searchResults).toBeNull();
    expect(state.searchMode).toBe(false);
    expect(state.activeSearchQuery).toBe('');
    expect(state.focusedSpaceId).toBeNull();
    expect(state.canvasSpaceId).toBeNull();
    expect(state.selectedIndex).toBe(-1);
    expect(state.recallHints.size).toBe(0);
  });

  // -- Setters ----------------------------------------------------------------

  it('setSpaces() updates spaces and notifies listeners', () => {
    const listener = vi.fn();
    const unsub = spaceStore.subscribe(listener);

    const spaces = [makeSpace({ id: '1' }), makeSpace({ id: '2' })];
    spaceStore.setSpaces(spaces);

    expect(spaceStore.getState().spaces).toEqual(spaces);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('setFilter() updates the filter', () => {
    spaceStore.setFilter('closed');
    expect(spaceStore.getState().filter).toBe('closed');
  });

  it('setSearchResults() updates search results', () => {
    const results = [makeSpace({ id: 'sr1' })];
    spaceStore.setSearchResults(results);
    expect(spaceStore.getState().searchResults).toEqual(results);

    spaceStore.setSearchResults(null);
    expect(spaceStore.getState().searchResults).toBeNull();
  });

  it('setFocusedSpace() updates the focused space id', () => {
    spaceStore.setFocusedSpace('abc');
    expect(spaceStore.getState().focusedSpaceId).toBe('abc');

    spaceStore.setFocusedSpace(null);
    expect(spaceStore.getState().focusedSpaceId).toBeNull();
  });

  it('setCanvasSpace() updates the canvas space id', () => {
    spaceStore.setCanvasSpace('xyz');
    expect(spaceStore.getState().canvasSpaceId).toBe('xyz');

    spaceStore.setCanvasSpace(null);
    expect(spaceStore.getState().canvasSpaceId).toBeNull();
  });

  // -- Subscribe / unsubscribe ------------------------------------------------

  it('subscribe() returns a working unsubscribe function', () => {
    const listener = vi.fn();
    const unsub = spaceStore.subscribe(listener);

    spaceStore.setFilter('closed');
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    spaceStore.setFilter('agents');
    expect(listener).toHaveBeenCalledTimes(1); // not called again
  });

  it('multiple listeners are all notified', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = spaceStore.subscribe(listener1);
    const unsub2 = spaceStore.subscribe(listener2);

    spaceStore.setFilter('agents');

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });

  // -- getFilteredSpaces() ---------------------------------------------------

  describe('getFilteredSpaces()', () => {
    const captured = makeSpace({ id: '1', status: 'captured' });
    const inProgress = makeSpace({ id: '2', status: 'in_progress' });
    const done = makeSpace({ id: '3', status: 'done' });

    beforeEach(() => {
      spaceStore.setSpaces([captured, inProgress, done]);
    });

    it('filter "open" returns spaces that are not done', () => {
      spaceStore.setFilter('open');
      const result = spaceStore.getFilteredSpaces();
      expect(result).toEqual([captured, inProgress]);
    });

    it('filter "closed" returns only done spaces', () => {
      spaceStore.setFilter('closed');
      const result = spaceStore.getFilteredSpaces();
      expect(result).toEqual([done]);
    });

    it('filter "agents" returns all spaces', () => {
      spaceStore.setFilter('agents');
      const result = spaceStore.getFilteredSpaces();
      expect(result).toEqual([captured, inProgress, done]);
    });

    it('filter "skills" returns all spaces', () => {
      spaceStore.setFilter('skills');
      const result = spaceStore.getFilteredSpaces();
      expect(result).toEqual([captured, inProgress, done]);
    });

    it('returns searchResults when set, regardless of filter', () => {
      const searchHit = makeSpace({ id: 'search-1', status: 'done' });
      spaceStore.setSearchResults([searchHit]);
      spaceStore.setFilter('open');

      expect(spaceStore.getFilteredSpaces()).toEqual([searchHit]);
    });
  });

  // -- getSpace() ------------------------------------------------------------

  it('getSpace() returns the space by id', () => {
    const space = makeSpace({ id: 'find-me' });
    spaceStore.setSpaces([makeSpace({ id: 'other' }), space]);
    expect(spaceStore.getSpace('find-me')).toEqual(space);
  });

  it('updateSpaceTitle() changes only the matching space title', () => {
    const first = makeSpace({ id: 'first', description: 'Old' });
    const second = makeSpace({ id: 'second', description: 'Keep' });
    spaceStore.setSpaces([first, second]);

    spaceStore.updateSpaceTitle('first', 'New');

    expect(spaceStore.getSpace('first')?.description).toBe('New');
    expect(spaceStore.getSpace('second')?.description).toBe('Keep');
  });

  it('getSpace() returns undefined for unknown id', () => {
    spaceStore.setSpaces([makeSpace({ id: 'x' })]);
    expect(spaceStore.getSpace('nope')).toBeUndefined();
  });

  // -- Readonly state ---------------------------------------------------------

  it('getState() returns a Readonly snapshot', () => {
    spaceStore.setSpaces([makeSpace({ id: '1' })]);
    const state = spaceStore.getState();

    // Subsequent mutations should produce a new state object
    spaceStore.setFilter('closed');
    const state2 = spaceStore.getState();
    expect(state).not.toBe(state2);
    // Original snapshot is unchanged
    expect(state.filter).toBe('open');
    expect(state2.filter).toBe('closed');
  });

  // -- Search state -----------------------------------------------------------

  it('setSearchMode() / setActiveSearchQuery() update search state', () => {
    spaceStore.setSearchMode(true);
    spaceStore.setActiveSearchQuery('hello');

    const state = spaceStore.getState();
    expect(state.searchMode).toBe(true);
    expect(state.activeSearchQuery).toBe('hello');
  });

  // -- Selection --------------------------------------------------------------

  it('setSelectedIndex() updates selection', () => {
    spaceStore.setSelectedIndex(2);
    expect(spaceStore.getState().selectedIndex).toBe(2);

    spaceStore.setSelectedIndex(-1);
    expect(spaceStore.getState().selectedIndex).toBe(-1);
  });

  // -- Stale-fetch guards -----------------------------------------------------

  it('nextRequestId() returns monotonically increasing ids', () => {
    const id1 = spaceStore.nextRequestId();
    const id2 = spaceStore.nextRequestId();
    const id3 = spaceStore.nextRequestId();
    expect(id2).toBeGreaterThan(id1);
    expect(id3).toBeGreaterThan(id2);
  });

  it('isCurrentRequest() recognizes only the latest reservation', () => {
    const stale = spaceStore.nextRequestId();
    const fresh = spaceStore.nextRequestId();

    expect(spaceStore.isCurrentRequest(fresh)).toBe(true);
    expect(spaceStore.isCurrentRequest(stale)).toBe(false);
  });

  // -- Recall hints -----------------------------------------------------------

  it('setRecallHint(spaceId, match) stores the hint', () => {
    const match = { space_id: 's1', description: 'Old similar', completed_at: null, confidence: 0.8 };
    spaceStore.setRecallHint('s1', match);
    expect(spaceStore.getState().recallHints.get('s1')).toEqual(match);
  });

  it('setRecallHint(spaceId, null) removes the hint', () => {
    spaceStore.setRecallHint('s1', { space_id: 's1', description: 'd', completed_at: null, confidence: 1 });
    spaceStore.setRecallHint('s1', null);
    expect(spaceStore.getState().recallHints.has('s1')).toBe(false);
  });
});
