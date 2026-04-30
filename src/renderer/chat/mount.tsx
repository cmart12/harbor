import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatView } from './ChatView';

let root: Root | null = null;

export interface MountChatOptions {
  agentId?: string;
  agentPrompt: string;
  agentStatus: string;
  agentSource?: 'sdk' | 'cli';
  intentId?: string;
  pendingApprovalId?: string;
  pendingPermissionKind?: string;
  onClose: () => void;
  onOpenCli: (agentId: string) => void;
  onOpenCanvas?: (intentId: string) => void;
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
      intentId={options.intentId}
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
