import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MainList } from './MainList';
import type { MainListProps } from './MainList';
import { AgentSummary } from './AgentSummary';
import { FocusBanner } from './FocusBanner';
import type { FocusBannerProps } from './FocusBanner';

/**
 * Mounts the React tree for the main list area, the agent summary card,
 * and the focus banner. Returns an unmount function that tears down all
 * three roots.
 *
 * The caller (`app.ts`) provides:
 *   - The host DOM elements (#space-list, #agent-summary, #focus-banner).
 *   - The action callbacks used by the lists (these continue to live in
 *     app.ts during the migration as shims to `window.*` globals).
 */
export interface MountListsOptions {
  spaceListHost: HTMLElement;
  agentSummaryHost: HTMLElement;
  focusBannerHost: HTMLElement;
  mainList: MainListProps;
  focusBanner: FocusBannerProps;
}

interface MountedRoots {
  list: Root;
  summary: Root;
  banner: Root;
}

let mounted: MountedRoots | null = null;

export function mountLists(options: MountListsOptions): () => void {
  // Idempotency: unmount any previous roots first.
  if (mounted) {
    unmountLists();
  }

  const list = createRoot(options.spaceListHost);
  const summary = createRoot(options.agentSummaryHost);
  const banner = createRoot(options.focusBannerHost);

  list.render(<MainList {...options.mainList} />);
  summary.render(<AgentSummary />);
  banner.render(<FocusBanner {...options.focusBanner} />);

  mounted = { list, summary, banner };

  return unmountLists;
}

export function unmountLists(): void {
  if (!mounted) return;
  mounted.list.unmount();
  mounted.summary.unmount();
  mounted.banner.unmount();
  mounted = null;
}
