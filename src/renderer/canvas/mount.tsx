import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MarkdownCanvas, type MarkdownCanvasHandle, type AgentPersona, type MentionEvent } from './MarkdownCanvas';
import type { CanvasAgentInteraction, CanvasPresence, CanvasUser, CanvasDecoration, CanvasThreadAgentStatus } from './types';

let root: Root | null = null;
let canvasRef: React.RefObject<MarkdownCanvasHandle | null> = React.createRef();

// Error boundary to catch React render errors in the canvas tree
class CanvasErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[CanvasErrorBoundary] caught error:', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return React.createElement('div', { style: { padding: 24, color: 'red' } },
        React.createElement('h3', null, 'Canvas render error'),
        React.createElement('pre', null, this.state.error?.message || 'Unknown error')
      );
    }
    return this.props.children;
  }
}

export interface MountCanvasOptions {
  spaceId: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  theme: 'light' | 'dark';
  personas?: AgentPersona[];
  agentPresence?: CanvasPresence[];
  agentThreadStatuses?: CanvasThreadAgentStatus[];
  agentInteractions?: readonly CanvasAgentInteraction[];
  onDirtyChange: (dirty: boolean) => void;
  onSaveStatus: (status: string) => void;
  onAgentMentioned?: (event: MentionEvent) => void;
  onInlineMention?: (handle: string, lineMarkdown: string, lineNumber: number) => void;
  onForkSelection?: (selectedText: string) => void;
  onExtractToPage?: (selectedText: string) => void;
  titleFallback?: string;
  onTitleChange?: (title: string) => void;
}

export function mountCanvas(container: HTMLElement, options: MountCanvasOptions): void {
  console.log('[mountCanvas] called for space:', options.spaceId, 'content length:', options.content?.length);
  if (root) {
    root.unmount();
  }

  canvasRef = React.createRef();
  root = createRoot(container);
  root.render(
    <CanvasErrorBoundary>
      <MarkdownCanvas
      ref={canvasRef}
      spaceId={options.spaceId}
      initialContent={options.content}
      initialFrontmatter={options.frontmatter}
      theme={options.theme}
      personas={options.personas}
      agentPresence={options.agentPresence}
      agentThreadStatuses={options.agentThreadStatuses}
      agentInteractions={options.agentInteractions}
      onDirtyChange={options.onDirtyChange}
      onSaveStatus={options.onSaveStatus}
      onAgentMentioned={options.onAgentMentioned}
      onInlineMention={options.onInlineMention}
      onForkSelection={options.onForkSelection}
      onExtractToPage={options.onExtractToPage}
      titleFallback={options.titleFallback}
      onTitleChange={options.onTitleChange}
    />
    </CanvasErrorBoundary>
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

export function updateCanvasPresence(presence: CanvasPresence[]): void {
  canvasRef.current?.updatePresence(presence);
}

export function updateCanvasAgentThreadStatuses(statuses: CanvasThreadAgentStatus[]): void {
  canvasRef.current?.updateAgentThreadStatuses(statuses);
}

export function updateCanvasAgentInteractions(interactions: readonly CanvasAgentInteraction[]): void {
  canvasRef.current?.updateAgentInteractions(interactions);
}

export function updateCanvasPersonas(personas: AgentPersona[]): void {
  canvasRef.current?.updatePersonas(personas);
}

export function updateCanvasDecorations(decorations: readonly CanvasDecoration[]): void {
  canvasRef.current?.updateDecorations(decorations);
}

export function updateCanvasAgentUsers(users: CanvasUser[]): void {
  canvasRef.current?.updateAgentUsers(users);
}

export function replaceCanvasContent(content: string): void {
  canvasRef.current?.replaceContent(content);
}

export function addCanvasCommentReply(threadId: string, body: string): void {
  canvasRef.current?.addCommentReply(threadId, body);
}

export function updateCanvasFrontmatter(frontmatter: Record<string, unknown>): void {
  canvasRef.current?.updateFrontmatter(frontmatter);
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
