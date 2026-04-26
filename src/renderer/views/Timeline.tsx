import React from 'react';

export interface TimelineProps {
  onClose: () => void;
}

/**
 * Timeline view — activity history across intents.
 * TODO: Migrate timeline UI from app.ts
 */
export function Timeline({ onClose }: TimelineProps) {
  return <div className="timeline-view">Timeline (not yet migrated)</div>;
}
