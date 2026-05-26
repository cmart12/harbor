import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatView } from './ChatView';

let root: Root | null = null;

export interface MountChatOptions {
  agentId?: string;
  agentPrompt: string;
  agentStatus: string;
  agentSource?: 'sdk' | 'cli' | 'cca' | 'conduit';
  spaceId?: string;
  sandboxed?: boolean;
  pendingApprovalId?: string;
  pendingPermissionKind?: string;
  onClose: () => void;
  onOpenCli: (agentId: string) => void;
  onOpenCanvas?: (spaceId: string) => void;
}

export function mountChat(container: HTMLElement, options: MountChatOptions): void {
  if (root) {
    root.unmount();
  }

  root = createRoot(container);
  root.render(
    <ChatView
      agentId={options.agentId}
      agentPrompt={options.agentPrompt}
      agentStatus={options.agentStatus}
      agentSource={options.agentSource}
      spaceId={options.spaceId}
      sandboxed={options.sandboxed}
      pendingApprovalId={options.pendingApprovalId}
      pendingPermissionKind={options.pendingPermissionKind}
      onClose={options.onClose}
      onOpenCli={options.onOpenCli}
      onOpenCanvas={options.onOpenCanvas}
    />
  );
}

export function unmountChat(): void {
  if (root) {
    root.unmount();
    root = null;
  }
}
