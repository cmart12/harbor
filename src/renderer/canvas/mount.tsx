import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DocumintCanvas, type DocumintCanvasHandle, type DocumintCanvasProps, type AgentPersona, type MentionEvent } from './DocumintCanvas';
import type { Presence } from 'documint';

let root: Root | null = null;
let canvasRef: React.RefObject<DocumintCanvasHandle | null> = React.createRef();

export interface MountCanvasOptions {
  intentId: string;
  content: string;
  theme: 'light' | 'dark';
  personas?: AgentPersona[];
  agentPresence?: Presence[];
  onDirtyChange: (dirty: boolean) => void;
  onSaveStatus: (status: string) => void;
  onAgentMentioned?: (event: MentionEvent) => void;
}

export function mountCanvas(container: HTMLElement, options: MountCanvasOptions): void {
  if (root) {
    root.unmount();
  }

  canvasRef = React.createRef();
  root = createRoot(container);
  root.render(
    <DocumintCanvas
      ref={canvasRef}
      intentId={options.intentId}
      initialContent={options.content}
      theme={options.theme}
      personas={options.personas}
      agentPresence={options.agentPresence}
      onDirtyChange={options.onDirtyChange}
      onSaveStatus={options.onSaveStatus}
      onAgentMentioned={options.onAgentMentioned}
    />
  );
}

export async function unmountCanvas(): Promise<void> {
  if (canvasRef.current) {
    await canvasRef.current.saveNow();
  }
  if (root) {
    root.unmount();
    root = null;
  }
}

export function getCanvasContent(): string {
  return canvasRef.current?.getContent() ?? '';
}

export async function saveCanvas(): Promise<void> {
  if (canvasRef.current) {
    await canvasRef.current.saveNow();
  }
}

export function updateCanvasPresence(presence: Presence[]): void {
  canvasRef.current?.updatePresence(presence);
}

export function updateCanvasPersonas(personas: AgentPersona[]): void {
  canvasRef.current?.updatePersonas(personas);
}

export function addCanvasCommentReply(threadIndex: number, body: string): void {
  canvasRef.current?.addCommentReply(threadIndex, body);
}
