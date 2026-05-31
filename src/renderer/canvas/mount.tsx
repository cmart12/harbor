import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DocumintCanvas, type DocumintCanvasHandle, type DocumintCanvasProps, type AgentPersona, type MentionEvent } from './DocumintCanvas';
import type { DocumentPresence, DocumentUser, DocumintDecoration } from '@patniko/documint';

let root: Root | null = null;
let canvasRef: React.RefObject<DocumintCanvasHandle | null> = React.createRef();

export interface MountCanvasOptions {
  spaceId: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  theme: 'light' | 'dark';
  personas?: AgentPersona[];
  agentPresence?: DocumentPresence[];
  onDirtyChange: (dirty: boolean) => void;
  onSaveStatus: (status: string) => void;
  onAgentMentioned?: (event: MentionEvent) => void;
  onInlineMention?: (handle: string, lineMarkdown: string, lineNumber: number) => void;
  onForkSelection?: (selectedText: string) => void;
  onExtractToPage?: (selectedText: string) => void;
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
      spaceId={options.spaceId}
      initialContent={options.content}
      initialFrontmatter={options.frontmatter}
      theme={options.theme}
      personas={options.personas}
      agentPresence={options.agentPresence}
      onDirtyChange={options.onDirtyChange}
      onSaveStatus={options.onSaveStatus}
      onAgentMentioned={options.onAgentMentioned}
      onInlineMention={options.onInlineMention}
      onForkSelection={options.onForkSelection}
      onExtractToPage={options.onExtractToPage}
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

export function updateCanvasPresence(presence: DocumentPresence[]): void {
  canvasRef.current?.updatePresence(presence);
}

export function updateCanvasPersonas(personas: AgentPersona[]): void {
  canvasRef.current?.updatePersonas(personas);
}

export function updateCanvasDecorations(decorations: readonly DocumintDecoration[]): void {
  canvasRef.current?.updateDecorations(decorations);
}

export function updateCanvasAgentUsers(users: DocumentUser[]): void {
  canvasRef.current?.updateAgentUsers(users);
}

export function replaceCanvasContent(content: string): void {
  canvasRef.current?.replaceContent(content);
}

export function addCanvasCommentReply(threadId: string, body: string): void {
  canvasRef.current?.addCommentReply(threadId, body);
}

export function toggleCanvasMode(): { mode: string; error?: string } {
  return canvasRef.current?.toggleMode() ?? { mode: 'rendered' };
}

export function getCanvasEditorMode(): string {
  return canvasRef.current?.getEditorMode() ?? 'rendered';
}

export function appendCanvasLink(label: string, url: string): void {
  canvasRef.current?.appendLink(label, url);
}

export function replaceCanvasText(search: string, replacement: string): void {
  canvasRef.current?.replaceText(search, replacement);
}

export function getCanvasSelectedText(): string {
  return canvasRef.current?.getSelectedText() ?? '';
}
