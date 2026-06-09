import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
} from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { history } from '@milkdown/kit/plugin/history';
import { cursor } from '@milkdown/kit/plugin/cursor';
import { getMarkdown, replaceAll, insert } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';
import { MilkdownProvider, Milkdown, useEditor } from '@milkdown/react';
import { hostDecorationPlugin, decorationPluginKey } from './plugins/decoration-plugin';
import {
  commentPlugin,
  commentThreadAt,
  SET_THREADS,
  SET_ACTIVE,
} from './plugins/comment-plugin';
import { computeAnchor } from './anchor';
import type { CanvasDecoration, CommentThread, CommentTrigger, TextAnchor } from '../types';
import type { Rect, SelectionInfo } from './geometry';

/**
 * Imperative surface the canvas wrapper drives. The editor is *uncontrolled*:
 * it is created once from `initialContent`; subsequent edits flow OUT through
 * `onContentChanged`, and host-initiated updates flow IN through these methods.
 */
export interface MilkdownEditorHandle {
  isReady(): boolean;
  getMarkdown(): string;
  replaceAll(markdown: string): void;
  insertMarkdown(markdown: string, inline?: boolean): void;
  getSelectedText(): string;
  /** Quote + content-addressable anchor for the current selection (null if collapsed). */
  getSelectionAnchor(): { quote: string; anchor: TextAnchor } | null;
  focus(): void;
}

export interface MilkdownEditorProps {
  initialContent: string;
  theme: 'light' | 'dark';
  onContentChanged: (markdown: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  decorations?: readonly CanvasDecoration[];
  commentThreads?: readonly CommentThread[];
  activeCommentId?: string | null;
  commentTrigger?: CommentTrigger;
  /** Fired when the caret enters/leaves a commented range (or a thread is hovered). */
  onCommentActivate?: (threadId: string | null, rect: Rect | null) => void;
  /** Fired when the text selection changes (for the selection toolbar). */
  onSelectionChange?: (info: SelectionInfo | null) => void;
}

function rectFromRange(view: EditorView, from: number, to: number): Rect | null {
  try {
    const a = view.coordsAtPos(from);
    const b = view.coordsAtPos(to);
    const left = Math.min(a.left, b.left);
    const right = Math.max(a.right, b.right);
    const top = Math.min(a.top, b.top);
    const bottom = Math.max(a.bottom, b.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  } catch {
    return null;
  }
}

const MilkdownInner = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(
  function MilkdownInner(
    { initialContent, onContentChanged, onFocus, onBlur, decorations, commentThreads, activeCommentId, commentTrigger, onCommentActivate, onSelectionChange },
    ref,
  ) {
    // Latest callbacks via refs so the editor factory (created once) never goes stale.
    const onChangeRef = useRef(onContentChanged);
    onChangeRef.current = onContentChanged;
    const onFocusRef = useRef(onFocus);
    onFocusRef.current = onFocus;
    const onBlurRef = useRef(onBlur);
    onBlurRef.current = onBlur;
    const onCommentActivateRef = useRef(onCommentActivate);
    onCommentActivateRef.current = onCommentActivate;
    const onSelectionChangeRef = useRef(onSelectionChange);
    onSelectionChangeRef.current = onSelectionChange;
    const commentTriggerRef = useRef<CommentTrigger>(commentTrigger ?? 'caret');
    commentTriggerRef.current = commentTrigger ?? 'caret';

    // Suppress the markdownUpdated callback while we apply host-initiated changes
    // (replaceAll), so a programmatic write isn't echoed back as a user edit.
    const suppressRef = useRef(false);

    const { loading, get } = useEditor((root) => {
      return Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialContent);
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            attributes: {
              class: 'milkdown-prose',
              spellcheck: 'true',
            },
            handleDOMEvents: {
              ...(prev.handleDOMEvents ?? {}),
              mouseover: (view, event) => {
                if (commentTriggerRef.current !== 'hover-or-caret') return false;
                const target = event.target as HTMLElement | null;
                const el = target?.closest?.('.whim-comment') as HTMLElement | null;
                if (!el) return false;
                const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (!pos) return false;
                const range = commentThreadAt(view.state, pos.pos);
                if (range) {
                  const rect = rectFromRange(view, range.from, range.to);
                  onCommentActivateRef.current?.(range.threadId, rect);
                }
                return false;
              },
            },
          }));
          const l = ctx.get(listenerCtx);
          l.markdownUpdated((_ctx, markdown) => {
            if (suppressRef.current) return;
            onChangeRef.current(markdown);
          });
          l.focus(() => onFocusRef.current?.());
          l.blur(() => onBlurRef.current?.());
          l.selectionUpdated((sctx, selection) => {
            const view = sctx.get(editorViewCtx);
            const { from, to, empty } = selection;
            if (!empty) {
              const text = view.state.doc.textBetween(from, to, '\n', '\uFFFC');
              const rect = rectFromRange(view, from, to);
              if (rect && text.trim()) {
                onSelectionChangeRef.current?.({ text, from, to, rect });
              } else {
                onSelectionChangeRef.current?.(null);
              }
              return;
            }
            // Collapsed caret: surface the comment thread under the caret, if any.
            onSelectionChangeRef.current?.(null);
            const range = commentThreadAt(view.state, from);
            if (range) {
              const rect = rectFromRange(view, range.from, range.to);
              onCommentActivateRef.current?.(range.threadId, rect);
            } else {
              onCommentActivateRef.current?.(null, null);
            }
          });
        })
        .use(commonmark)
        .use(gfm)
        .use(listener)
        .use(clipboard)
        .use(history)
        .use(cursor)
        .use(hostDecorationPlugin)
        .use(commentPlugin);
    }, []);

    // Sync host-provided regex decorations.
    useEffect(() => {
      if (loading) return;
      get()?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setMeta(decorationPluginKey, (decorations ?? []) as CanvasDecoration[]));
      });
    }, [loading, get, decorations]);

    // Sync comment threads.
    useEffect(() => {
      if (loading) return;
      get()?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setMeta(SET_THREADS, (commentThreads ?? []) as CommentThread[]));
      });
    }, [loading, get, commentThreads]);

    // Sync active comment highlight.
    useEffect(() => {
      if (loading) return;
      get()?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setMeta(SET_ACTIVE, { id: activeCommentId ?? null }));
      });
    }, [loading, get, activeCommentId]);

    useImperativeHandle(
      ref,
      () => ({
        isReady: () => !!get(),
        getMarkdown: () => get()?.action(getMarkdown()) ?? '',
        replaceAll: (markdown: string) => {
          const ed = get();
          if (!ed) return;
          suppressRef.current = true;
          try {
            ed.action(replaceAll(markdown));
          } finally {
            suppressRef.current = false;
          }
        },
        insertMarkdown: (markdown: string, inline?: boolean) => {
          get()?.action(insert(markdown, inline));
        },
        getSelectedText: () => {
          const ed = get();
          if (!ed) return '';
          return ed.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { from, to, empty } = view.state.selection;
            if (empty) return '';
            return view.state.doc.textBetween(from, to, '\n', '\n');
          });
        },
        getSelectionAnchor: () => {
          const ed = get();
          if (!ed) return null;
          return ed.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { from, to, empty } = view.state.selection;
            if (empty) return null;
            return computeAnchor(view.state.doc, from, to);
          });
        },
        focus: () => {
          get()?.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            view.focus();
          });
        },
      }),
      [get],
    );

    return <Milkdown />;
  },
);

/**
 * Milkdown-based WYSIWYG markdown editor. Wraps the editor in its provider so a
 * single instance can be driven imperatively by the canvas wrapper.
 */
export const MilkdownEditor = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(
  function MilkdownEditor(props, ref) {
    return (
      <MilkdownProvider>
        <MilkdownInner ref={ref} {...props} />
      </MilkdownProvider>
    );
  },
);
