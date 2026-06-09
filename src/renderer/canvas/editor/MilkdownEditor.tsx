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
import { MilkdownProvider, Milkdown, useEditor } from '@milkdown/react';
import { hostDecorationPlugin, decorationPluginKey } from './plugins/decoration-plugin';
import type { CanvasDecoration } from '../types';

/**
 * Imperative surface the canvas wrapper drives. The editor is *uncontrolled*:
 * it is created once from `initialContent`; subsequent edits flow OUT through
 * `onContentChanged`, and host-initiated updates flow IN through these methods.
 */
export interface MilkdownEditorHandle {
  isReady(): boolean;
  /** Serialize the current document to markdown. */
  getMarkdown(): string;
  /** Replace the whole document from a markdown string (re-parses). */
  replaceAll(markdown: string): void;
  /** Insert markdown at the current selection. */
  insertMarkdown(markdown: string, inline?: boolean): void;
  /** Plain text of the current selection (empty when collapsed). */
  getSelectedText(): string;
  /** Focus the editable surface. */
  focus(): void;
}

export interface MilkdownEditorProps {
  initialContent: string;
  theme: 'light' | 'dark';
  onContentChanged: (markdown: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  decorations?: readonly CanvasDecoration[];
}

const MilkdownInner = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(
  function MilkdownInner({ initialContent, onContentChanged, onFocus, onBlur, decorations }, ref) {
    // Latest callbacks via refs so the editor factory (created once) never goes stale.
    const onChangeRef = useRef(onContentChanged);
    onChangeRef.current = onContentChanged;
    const onFocusRef = useRef(onFocus);
    onFocusRef.current = onFocus;
    const onBlurRef = useRef(onBlur);
    onBlurRef.current = onBlur;

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
          }));
          const l = ctx.get(listenerCtx);
          l.markdownUpdated((_ctx, markdown) => {
            if (suppressRef.current) return;
            onChangeRef.current(markdown);
          });
          l.focus(() => onFocusRef.current?.());
          l.blur(() => onBlurRef.current?.());
        })
        .use(commonmark)
        .use(gfm)
        .use(listener)
        .use(clipboard)
        .use(history)
        .use(cursor)
        .use(hostDecorationPlugin);
    }, []);

    // Sync host-provided regex decorations into the plugin whenever they change.
    useEffect(() => {
      if (loading) return;
      const ed = get();
      if (!ed) return;
      ed.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setMeta(decorationPluginKey, (decorations ?? []) as CanvasDecoration[]));
      });
    }, [loading, get, decorations]);

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
