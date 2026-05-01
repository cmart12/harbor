import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConduitChatView } from './ConduitChatView';

let root: Root | null = null;

export interface MountConduitChatOptions {
  agentId?: string;
  conduitSessionId?: string;
  agentPrompt: string;
  agentStatus: string;
  spaceId?: string;
  pendingApprovalId?: string;
  pendingPermissionKind?: string;
  onClose: () => void;
}

export function mountConduitChat(container: HTMLElement, options: MountConduitChatOptions): void {
  if (root) {
    root.unmount();
  }

  root = createRoot(container);
  root.render(
    <ConduitChatView
      agentId={options.agentId}
      conduitSessionId={options.conduitSessionId}
      agentPrompt={options.agentPrompt}
      agentStatus={options.agentStatus}
      spaceId={options.spaceId}
      pendingApprovalId={options.pendingApprovalId}
      pendingPermissionKind={options.pendingPermissionKind}
      onClose={options.onClose}
    />
  );
}

export function unmountConduitChat(): void {
  if (root) {
    root.unmount();
    root = null;
  }
}
