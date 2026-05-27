import type { SpaceEvent } from '../../shared/ipc-contract';

export interface HistoryState {
  /** Most-recent timeline events (matches `whimAPI.listEvents(limit)`). */
  events: SpaceEvent[];
}

type Listener = () => void;

class HistoryStore {
  private state: HistoryState = {
    events: [],
  };
  private listeners: Set<Listener> = new Set();
  private requestCounter = 0;
  private latestRequestId = 0;

  getState(): Readonly<HistoryState> {
    return this.state;
  }

  setEvents(events: SpaceEvent[]): void {
    this.state = { ...this.state, events };
    this.notify();
  }

  // -- Stale-fetch guards -----------------------------------------------------

  nextRequestId(): number {
    this.requestCounter += 1;
    this.latestRequestId = this.requestCounter;
    return this.latestRequestId;
  }

  isCurrentRequest(id: number): boolean {
    return id === this.latestRequestId;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -- Derived state helpers --------------------------------------------------

  /** Group events by their space_id (skips events without a space). */
  getEventsBySpace(): Map<string, SpaceEvent[]> {
    const map = new Map<string, SpaceEvent[]>();
    for (const event of this.state.events) {
      const id = event.space_id;
      if (!id) continue;
      const list = map.get(id);
      if (list) list.push(event);
      else map.set(id, [event]);
    }
    return map;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const historyStore = new HistoryStore();
