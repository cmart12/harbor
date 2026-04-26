import type { Intent } from '../../shared/types';

export type IntentFilter = 'open' | 'agents' | 'closed';

export interface IntentState {
  intents: Intent[];
  filter: IntentFilter;
  searchResults: Intent[] | null;
  focusedIntentId: string | null;
  canvasIntentId: string | null;
}

type Listener = () => void;

class IntentStore {
  private state: IntentState = {
    intents: [],
    filter: 'open',
    searchResults: null,
    focusedIntentId: null,
    canvasIntentId: null,
  };
  private listeners: Set<Listener> = new Set();

  getState(): Readonly<IntentState> {
    return this.state;
  }

  setIntents(intents: Intent[]): void {
    this.state = { ...this.state, intents };
    this.notify();
  }

  setFilter(filter: IntentFilter): void {
    this.state = { ...this.state, filter };
    this.notify();
  }

  setSearchResults(results: Intent[] | null): void {
    this.state = { ...this.state, searchResults: results };
    this.notify();
  }

  setFocusedIntent(id: string | null): void {
    this.state = { ...this.state, focusedIntentId: id };
    this.notify();
  }

  setCanvasIntent(id: string | null): void {
    this.state = { ...this.state, canvasIntentId: id };
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

  /** Return intents matching the current filter (or search results when active). */
  getFilteredIntents(): Intent[] {
    const { intents, filter, searchResults } = this.state;
    if (searchResults !== null) return searchResults;

    switch (filter) {
      case 'open':
        return intents.filter(i => i.status !== 'done');
      case 'closed':
        return intents.filter(i => i.status === 'done');
      case 'agents':
        return intents;
      default:
        return intents;
    }
  }

  getIntent(id: string): Intent | undefined {
    return this.state.intents.find(i => i.id === id);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const intentStore = new IntentStore();
