import type { Space } from '../../shared/types';
import type { RecallMatch } from '../../shared/types';

export type SpaceFilter = 'feed' | 'open' | 'agents' | 'skills' | 'closed';

export interface SpaceState {
  spaces: Space[];
  filter: SpaceFilter;
  searchResults: Space[] | null;
  searchMode: boolean;
  activeSearchQuery: string;
  focusedSpaceId: string | null;
  canvasSpaceId: string | null;
  /** Index of the keyboard-selected row in the currently displayed list (-1 = none). */
  selectedIndex: number;
  /** Transient "similar previous space" hints, keyed by space id. */
  recallHints: Map<string, RecallMatch>;
}

type Listener = () => void;

class SpaceStore {
  private state: SpaceState = {
    spaces: [],
    filter: 'open',
    searchResults: null,
    searchMode: false,
    activeSearchQuery: '',
    focusedSpaceId: null,
    canvasSpaceId: null,
    selectedIndex: -1,
    recallHints: new Map(),
  };
  private listeners: Set<Listener> = new Set();
  /** Monotonic counter for stale-fetch detection (replaces app.ts:renderGeneration). */
  private requestCounter = 0;
  private latestRequestId = 0;

  getState(): Readonly<SpaceState> {
    return this.state;
  }

  setSpaces(spaces: Space[]): void {
    this.state = { ...this.state, spaces };
    this.notify();
  }

  /**
   * Insert a space at the top of the list, or replace it in place if a space
   * with the same id already exists. Used for optimistic insertion right after
   * creation so the new row renders without a full list reload.
   */
  upsertSpace(space: Space): void {
    const existingIdx = this.state.spaces.findIndex(s => s.id === space.id);
    let spaces: Space[];
    if (existingIdx >= 0) {
      spaces = this.state.spaces.slice();
      spaces[existingIdx] = space;
    } else {
      spaces = [space, ...this.state.spaces];
    }
    this.state = { ...this.state, spaces };
    this.notify();
  }

  updateSpaceTitle(id: string, title: string): void {
    let changed = false;
    const spaces = this.state.spaces.map((space) => {
      if (space.id !== id || space.description === title) return space;
      changed = true;
      return { ...space, description: title };
    });
    if (!changed) return;
    this.state = { ...this.state, spaces };
    this.notify();
  }

  setFilter(filter: SpaceFilter): void {
    this.state = { ...this.state, filter };
    this.notify();
  }

  setSearchResults(results: Space[] | null): void {
    this.state = { ...this.state, searchResults: results };
    this.notify();
  }

  setSearchMode(searchMode: boolean): void {
    this.state = { ...this.state, searchMode };
    this.notify();
  }

  setActiveSearchQuery(query: string): void {
    this.state = { ...this.state, activeSearchQuery: query };
    this.notify();
  }

  setFocusedSpace(id: string | null): void {
    this.state = { ...this.state, focusedSpaceId: id };
    this.notify();
  }

  setCanvasSpace(id: string | null): void {
    this.state = { ...this.state, canvasSpaceId: id };
    this.notify();
  }

  setSelectedIndex(index: number): void {
    this.state = { ...this.state, selectedIndex: index };
    this.notify();
  }

  // -- Recall hints -----------------------------------------------------------

  setRecallHint(spaceId: string, match: RecallMatch | null): void {
    const next = new Map(this.state.recallHints);
    if (match) next.set(spaceId, match);
    else next.delete(spaceId);
    this.state = { ...this.state, recallHints: next };
    this.notify();
  }

  // -- Stale-fetch guards (replaces app.ts:renderGeneration) ------------------

  /** Reserve a new request id. Latest reservation wins. */
  nextRequestId(): number {
    this.requestCounter += 1;
    this.latestRequestId = this.requestCounter;
    return this.latestRequestId;
  }

  /** True if the given id is still the latest reserved id. */
  isCurrentRequest(id: number): boolean {
    return id === this.latestRequestId;
  }

  /** Subscribe to state changes. Returns an unsubscribe function (useSyncExternalStore-compatible). */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -- Derived state helpers --------------------------------------------------

  /** Return spaces matching the current filter (or search results when active). */
  getFilteredSpaces(): Space[] {
    const { spaces, filter, searchResults } = this.state;
    if (searchResults !== null) return searchResults;

    switch (filter) {
      case 'open':
        return spaces.filter(i => i.status !== 'done');
      case 'closed':
        return spaces.filter(i => i.status === 'done');
      case 'agents':
      case 'skills':
        return spaces;
      case 'feed':
        // Feed is not backed by the spaces table; its data source lands in
        // Phase A.2. Return an empty list so any caller that does fall
        // through to this method gets a benign result.
        return [];
      default:
        return spaces;
    }
  }

  getSpace(id: string): Space | undefined {
    return this.state.spaces.find(i => i.id === id);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const spaceStore = new SpaceStore();
