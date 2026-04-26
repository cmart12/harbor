import React from 'react';
import type { Intent } from '../../shared/types';
import type { IntentFilter } from '../state/intent-store';

export interface IntentListProps {
  intents: Intent[];
  filter: IntentFilter;
  focusedIntentId: string | null;
  onFilterChange: (filter: IntentFilter) => void;
  onIntentClick: (intentId: string) => void;
  onIntentDelete: (intentId: string) => void;
  onIntentComplete: (intentId: string) => void;
}

/**
 * Intent list view — filterable list of captured intents.
 * TODO: Migrate intent list UI from app.ts
 */
export function IntentList(props: IntentListProps) {
  return <div className="intent-list">IntentList (not yet migrated)</div>;
}
