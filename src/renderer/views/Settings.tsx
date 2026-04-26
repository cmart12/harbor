import React from 'react';
import type { IntentAPI } from '../ipc-client';

export interface SettingsProps {
  onClose: () => void;
}

/**
 * Settings panel — workspace, theme, model, personas, MCP servers, CLI tools.
 * TODO: Migrate settings UI from app.ts
 */
export function Settings({ onClose }: SettingsProps) {
  return <div className="settings-panel">Settings (not yet migrated)</div>;
}
