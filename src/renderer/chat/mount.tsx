import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatView } from './ChatView';

let root: Root | null = null;

export interface MountChatOptions {
  agentId?: string;
  agentPrompt: string;
  agentStatus: string;
  agentSource?: 'sdk' | 'cli';
  onClose: () => void;
  onOpenCli: (agentId: string) => void;
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
      onClose={options.onClose}
      onOpenCli={options.onOpenCli}
    />
  );
}

export function unmountChat(): void {
  if (root) {
    root.unmount();
    root = null;
  }
}
