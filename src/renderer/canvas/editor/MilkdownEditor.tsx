import React, {
  forwardRef,
  useCallback,
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
  parserCtx,
} from '@milkdown/kit/core';
import { commonmark, toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand } from '@milkdown/kit/preset/commonmark';
import { gfm, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { history } from '@milkdown/kit/plugin/history';
import { cursor } from '@milkdown/kit/plugin/cursor';
import { getMarkdown, replaceAll, insert, callCommand } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';
import { MilkdownProvider, Milkdown, useEditor } from '@milkdown/react';
import { hostDecorationPlugin, decorationPluginKey } from './plugins/decoration-plugin';
import {
  commentPlugin,
  commentThreadAt,
  SET_THREADS,
  SET_ACTIVE,
  SET_AGENT_THREAD_STATUSES,
} from './plugins/comment-plugin';
import { computeAnchor } from './anchor';
import { createImageNodeView, createImagePasteHandler, type ImageSrcResolver, type ImageUploader } from './plugins/image-view';
import { presencePlugin, SET_PRESENCE } from './plugins/presence-plugin';
import { SUPPRESS_TYPING_EFFECTS, typingEffectsPlugin } from './plugins/typing-effects-plugin';
import type { CanvasDecoration, CanvasPresence, CanvasThreadAgentStatus, CommentThread, CommentTrigger, TextAnchor } from '../types';
import type { Rect, SelectionInfo, MentionQuery, FormatMark } from './geometry';
import type { EditorState } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';

const MARK_COMMANDS = {
  strong: toggleStrongCommand,
  emphasis: toggleEmphasisCommand,
  inlineCode: toggleInlineCodeCommand,
  strikethrough: toggleStrikethroughCommand,
} as const;

/**
 * Imperative surface the canvas wrapper drives. The editor is *uncontrolled*:
 * it is created once from `initialContent`; subsequent edits flow OUT through
 * `onContentChanged`, and host-initiated updates flow IN through these methods.
 */
export interface MilkdownEditorHandle {
  isReady(): boolean;
  getMarkdown(): string;
  replaceAll(markdown: string, options?: ReplaceAllOptions): void;
  insertMarkdown(markdown: string, inline?: boolean, options?: ReplaceAllOptions): void;
  getSelectedText(): string;
  /** Quote + content-addressable anchor for the current selection (null if collapsed). */
  getSelectionAnchor(): { quote: string; anchor: TextAnchor } | null;
  /** Replace an `@`-mention query range with `@handle ` and report the line. */
  applyMention(handle: string, from: number, to: number): { lineMarkdown: string; lineNumber: number } | null;
  /** Toggle an inline formatting mark over the current selection. */
  toggleMark(mark: FormatMark): void;
  focus(): void;
}

export interface ReplaceAllOptions {
  animate?: boolean;
}

export interface MilkdownEditorProps {
  initialContent: string;
  theme: 'light' | 'dark';
  onContentChanged: (markdown: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  decorations?: readonly CanvasDecoration[];
  presence?: readonly CanvasPresence[];
  commentThreads?: readonly CommentThread[];
  commentAgentStatuses?: readonly CanvasThreadAgentStatus[];
  activeCommentId?: string | null;
  commentTrigger?: CommentTrigger;
  /** Resolve workspace-relative image srcs into displayable URLs. */
  resolveImageSrc?: ImageSrcResolver;
  /** Persist a pasted image file, returning its workspace-relative src. */
  uploadFile?: ImageUploader;
  /** Fired when the caret enters/leaves a commented range (or a thread is hovered). */
  onCommentActivate?: (threadId: string | null, rect: Rect | null) => void;
  /** Fired when the text selection changes (for the selection toolbar). */
  onSelectionChange?: (info: SelectionInfo | null) => void;
  /** Fired with the active `@`-mention query (for the suggestion popup), or null. */
  onMentionQuery?: (info: MentionQuery | null) => void;
  /** Fired when a link is clicked, with its raw href (for whim:// / external routing). */
  onLinkClick?: (url: string) => void;
}

/** Detect an in-progress `@`-mention immediately before a collapsed caret. */
function detectMention(state: EditorState): { from: number; to: number; query: string } | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $from = sel.$from;
  if (!$from.parent.isTextblock) return null;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC');
  const m = /(^|\s)@([\w-]*)$/.exec(textBefore);
  if (!m) return null;
  const query = m[2];
  const to = $from.pos;
  const from = to - query.length - 1; // include the '@'
  return { from, to, query };
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

/**
 * Bounding rect of the selection built from a DOM Range at the ProseMirror
 * positions. `getBoundingClientRect` on a multi-line range returns the true
 * union box (ProseMirror endpoint coords don't span lines), and unlike reading
 * `window.getSelection()` it's valid synchronously during a transaction.
 */
function domRangeRect(view: EditorView, from: number, to: number): Rect | null {
  try {
    if (typeof document === 'undefined') return null;
    const a = view.domAtPos(from);
    const b = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const r = range.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return null;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  } catch {
    return null;
  }
}

/** Best available rect for a selection: true highlight box, else PM endpoints. */
function selectionRect(view: EditorView, from: number, to: number): Rect | null {
  return domRangeRect(view, from, to) ?? rectFromRange(view, from, to);
}

function replaceChangedRange(view: EditorView, nextDoc: ProseNode): void {
  const { state } = view;
  const start = state.doc.content.findDiffStart(nextDoc.content);
  if (start === null) return;

  const end = state.doc.content.findDiffEnd(nextDoc.content);
  if (!end) return;

  view.dispatch(state.tr.replace(start, end.a, nextDoc.slice(start, end.b)));
}

const MilkdownInner = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(
  function MilkdownInner(
    { initialContent, onContentChanged, onFocus, onBlur, decorations, presence, commentThreads, commentAgentStatuses, activeCommentId, commentTrigger, resolveImageSrc, uploadFile, onCommentActivate, onSelectionChange, onMentionQuery, onLinkClick },
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
    const onMentionQueryRef = useRef(onMentionQuery);
    onMentionQueryRef.current = onMentionQuery;
    const onLinkClickRef = useRef(onLinkClick);
    onLinkClickRef.current = onLinkClick;
    const commentTriggerRef = useRef<CommentTrigger>(commentTrigger ?? 'caret');
    commentTriggerRef.current = commentTrigger ?? 'caret';
    const resolveImageSrcRef = useRef<ImageSrcResolver | undefined>(resolveImageSrc);
    resolveImageSrcRef.current = resolveImageSrc;
    const uploadFileRef = useRef<ImageUploader | undefined>(uploadFile);
    uploadFileRef.current = uploadFile;

    // Milkdown's markdownUpdated is debounced (~200ms), so a synchronous flag
    // can't gate it. Instead we remember the exact serialized markdown produced
    // by a programmatic replaceAll and skip the one echo that matches it, so a
    // host-initiated write isn't re-delivered as a user edit.
    const pendingEchoRef = useRef<string | null>(null);

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
            nodeViews: {
              ...prev.nodeViews,
              image: createImageNodeView(resolveImageSrcRef),
            },
            handlePaste: createImagePasteHandler(uploadFileRef),
            handleDOMEvents: {
              ...prev.handleDOMEvents,
              click: (_view, event) => {
                const target = event.target as HTMLElement | null;
                const a = target?.closest?.('a') as HTMLAnchorElement | null;
                if (!a) return false;
                const href = a.getAttribute('href');
                if (!href) return false;
                event.preventDefault();
                onLinkClickRef.current?.(href);
                return true;
              },
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
            if (pendingEchoRef.current !== null) {
              const expected = pendingEchoRef.current;
              pendingEchoRef.current = null;
              if (markdown === expected) return; // swallow the programmatic echo
            }
            onChangeRef.current(markdown);
          });
          l.focus(() => onFocusRef.current?.());
          l.blur(() => onBlurRef.current?.());
          l.selectionUpdated((sctx, selection) => {
            const view = sctx.get(editorViewCtx);
            const { from, to, empty } = selection;
            if (!empty) {
              onMentionQueryRef.current?.(null);
              const text = view.state.doc.textBetween(from, to, '\n', '\uFFFC');
              const rect = selectionRect(view, from, to);
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
            // Surface any in-progress @-mention query for the suggestion popup.
            const mention = detectMention(view.state);
            if (mention) {
              const rect = rectFromRange(view, mention.from, mention.from);
              if (rect) onMentionQueryRef.current?.({ ...mention, rect });
              else onMentionQueryRef.current?.(null);
            } else {
              onMentionQueryRef.current?.(null);
            }
          });
        })
        .use(commonmark)
        .use(gfm)
        .use(listener)
        .use(clipboard)
        .use(history)
        .use(cursor)
        .use(typingEffectsPlugin)
        .use(hostDecorationPlugin)
        .use(commentPlugin)
        .use(presencePlugin);
    }, []);

    // Dispatch a plugin meta transaction, tolerating a torn-down view (can happen
    // under React StrictMode's mount→destroy→remount with async editor create).
    const dispatchMeta = useCallback((metaKey: unknown, value: unknown) => {
      try {
        get()?.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.dispatch(view.state.tr.setMeta(metaKey as any, value));
        });
      } catch {
        /* view torn down between get() and dispatch */
      }
    }, [get]);

    // Sync host-provided regex decorations.
    useEffect(() => {
      if (!loading) dispatchMeta(decorationPluginKey, (decorations ?? []) as CanvasDecoration[]);
    }, [loading, dispatchMeta, decorations]);

    // Sync comment threads.
    useEffect(() => {
      if (!loading) dispatchMeta(SET_THREADS, (commentThreads ?? []) as CommentThread[]);
    }, [loading, dispatchMeta, commentThreads]);

    // Sync agent presence carets.
    useEffect(() => {
      if (!loading) dispatchMeta(SET_PRESENCE, (presence ?? []) as CanvasPresence[]);
    }, [loading, dispatchMeta, presence]);

    // Sync active comment highlight.
    useEffect(() => {
      if (!loading) dispatchMeta(SET_ACTIVE, { id: activeCommentId ?? null });
    }, [loading, dispatchMeta, activeCommentId]);

    // Sync transient thread-linked agent status highlights.
    useEffect(() => {
      if (!loading) dispatchMeta(SET_AGENT_THREAD_STATUSES, (commentAgentStatuses ?? []) as CanvasThreadAgentStatus[]);
    }, [loading, dispatchMeta, commentAgentStatuses]);

    useImperativeHandle(
      ref,
      () => ({
        isReady: () => !!get(),
        getMarkdown: () => get()?.action(getMarkdown()) ?? '',
        replaceAll: (markdown: string, options?: ReplaceAllOptions) => {
          const ed = get();
          if (!ed) return;
          ed.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const animate = options?.animate === true;
            if (!animate) view.dispatch(view.state.tr.setMeta(SUPPRESS_TYPING_EFFECTS, true));
            try {
              if (animate) {
                const nextDoc = ctx.get(parserCtx)(markdown);
                if (!nextDoc) return;
                replaceChangedRange(view, nextDoc);
              } else {
                replaceAll(markdown)(ctx);
              }
              // Record the editor's own serialization of the new doc — that's the
              // exact string the debounced markdownUpdated echo will carry.
              try {
                pendingEchoRef.current = getMarkdown()(ctx);
              } catch {
                pendingEchoRef.current = markdown;
              }
            } finally {
              if (!animate) view.dispatch(view.state.tr.setMeta(SUPPRESS_TYPING_EFFECTS, false));
            }
          });
        },
        insertMarkdown: (markdown: string, inline?: boolean, options?: ReplaceAllOptions) => {
          get()?.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const animate = options?.animate === true;
            if (!animate) view.dispatch(view.state.tr.setMeta(SUPPRESS_TYPING_EFFECTS, true));
            try {
              insert(markdown, inline)(ctx);
            } finally {
              if (!animate) view.dispatch(view.state.tr.setMeta(SUPPRESS_TYPING_EFFECTS, false));
            }
          });
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
        applyMention: (handle: string, from: number, to: number) => {
          const ed = get();
          if (!ed) return null;
          return ed.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const docSize = view.state.doc.content.size;
            if (from < 0 || to > docSize || from > to) return null;
            // Guard against a stale range: the span must still be the @-query.
            const existing = view.state.doc.textBetween(from, to, '\n', '\uFFFC');
            if (!existing.startsWith('@')) return null;
            const tr = view.state.tr.insertText(`@${handle} `, from, to);
            view.dispatch(tr);
            view.focus();
            const $pos = view.state.selection.$from;
            const lineMarkdown = $pos.parent.textContent;
            const lineNumber = $pos.before();
            return { lineMarkdown, lineNumber };
          });
        },
        toggleMark: (mark: FormatMark) => {
          const ed = get();
          if (!ed) return;
          const command = MARK_COMMANDS[mark];
          if (!command) return;
          ed.action(callCommand(command.key));
          ed.action((ctx) => ctx.get(editorViewCtx).focus());
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
