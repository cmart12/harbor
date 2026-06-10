import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { $prose } from '@milkdown/kit/utils';
import type { CanvasDecoration } from '../../types';
import { safePluginApply } from './plugin-utils';

export const decorationPluginKey = new PluginKey('whim-host-decorations');

/**
 * Build an inline DecorationSet by scanning the document's text blocks for each
 * host-provided regex pattern. Mirrors documint's `decorations` prop: regex
 * highlight that is presentation-only and never serialized to markdown.
 */
function buildDecorationSet(doc: ProseNode, decorations: CanvasDecoration[]): DecorationSet {
  if (decorations.length === 0) return DecorationSet.empty;

  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    // Use a placeholder for inline leaves (images, hard breaks) so text offsets
    // stay aligned with ProseMirror positions (textContent would drop them).
    const text = node.textBetween(0, node.content.size, undefined, '\uFFFC');
    if (!text) return;
    // Block text starts at pos + 1 (inside the block node).
    const base = pos + 1;
    for (const d of decorations) {
      const flags = d.pattern.flags.includes('g') ? d.pattern.flags : d.pattern.flags + 'g';
      const re = new RegExp(d.pattern.source, flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        const from = base + m.index;
        const to = from + m[0].length;
        const style: string[] = [];
        if (d.backgroundColor) style.push(`background-color:${d.backgroundColor}`);
        if (d.color) style.push(`color:${d.color}`);
        decos.push(
          Decoration.inline(from, to, {
            style: style.join(';'),
            class: d.pulse ? 'whim-decoration whim-decoration-pulse' : 'whim-decoration',
          }),
        );
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

interface DecoState {
  decorations: CanvasDecoration[];
  set: DecorationSet;
}

/**
 * ProseMirror plugin that renders host-provided regex decorations. Update the
 * active set by dispatching a transaction carrying `decorationPluginKey` meta.
 */
export const hostDecorationPlugin = $prose(() => {
  return new Plugin<DecoState>({
    key: decorationPluginKey,
    state: {
      init: (_config, state) => ({ decorations: [], set: buildDecorationSet(state.doc, []) }),
      apply(tr, value, _oldState, newState): DecoState {
        return safePluginApply('host-decorations', value, () => {
          const meta = tr.getMeta(decorationPluginKey) as CanvasDecoration[] | undefined;
          if (meta) {
            return { decorations: meta, set: buildDecorationSet(newState.doc, meta) };
          }
          if (tr.docChanged && value.decorations.length > 0) {
            return { decorations: value.decorations, set: buildDecorationSet(newState.doc, value.decorations) };
          }
          return value;
        });
      },
    },
    props: {
      decorations(state) {
        return (decorationPluginKey.getState(state) as DecoState | undefined)?.set ?? DecorationSet.empty;
      },
    },
  });
});
