import type { Space } from '../../shared/types';

export type SpaceFilter = 'open' | 'agents' | 'closed';

export interface SpaceState {
  spaces: Space[];
  filter: SpaceFilter;
  searchResults: Space[] | null;
  focusedSpaceId: string | null;
  canvasSpaceId: string | null;
}

type Listener = () => void;

class SpaceStore {
  private state: SpaceState = {
    spaces: [],
    filter: 'open',
    searchResults: null,
    focusedSpaceId: null,
    canvasSpaceId: null,
  };
  private listeners: Set<Listener> = new Set();

  getState(): Readonly<SpaceState> {
    return this.state;
  }

  setSpaces(spaces: Space[]): void {
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

  setFocusedSpace(id: string | null): void {
    this.state = { ...this.state, focusedSpaceId: id };
    this.notify();
  }

  setCanvasSpace(id: string | null): void {
    this.state = { ...this.state, canvasSpaceId: id };
    this.notify();
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
        return spaces;
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
