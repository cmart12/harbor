import { useSyncExternalStore } from 'react';

/**
 * Bind a typed store to React via `useSyncExternalStore`.
 *
 * Components destructure what they need from the returned state. Re-renders
 * happen on every store notify; rely on `React.memo` on row components and
 * stable item keys for efficient reconciliation.
 *
 * Stores must return the same state reference between mutations (already
 * how space-store / agent-store / skill-store / history-store / persona-store
 * are implemented).
 */
export interface Store<S> {
  getState(): S;
  subscribe(listener: () => void): () => void;
}

export function useStore<S>(store: Store<S>): S {
  return useSyncExternalStore(
    store.subscribe.bind(store),
    store.getState.bind(store),
  );
}
