import React from 'react';
import type { Space } from '../../shared/types';
import type { SpaceFilter } from '../state/space-store';

export interface SpaceListProps {
  intents: Space[];
  filter: SpaceFilter;
  focusedSpaceId: string | null;
  onFilterChange: (filter: SpaceFilter) => void;
  onIntentClick: (spaceId: string) => void;
  onIntentDelete: (spaceId: string) => void;
  onIntentComplete: (spaceId: string) => void;
}

/**
 * Space list view — filterable list of captured intents.
 * TODO: Migrate space list UI from app.ts
 */
export function SpaceList(props: SpaceListProps) {
  return <div className="space-list">SpaceList (not yet migrated)</div>;
}
