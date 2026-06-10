import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { $prose } from '@milkdown/kit/utils';
import type { CanvasPresence } from '../../types';
import { resolveCaretAnchor } from '../anchor';
import { safePluginApply } from './plugin-utils';

export const presencePluginKey = new PluginKey('whim-presence');
export const SET_PRESENCE = 'whim-set-presence';

function colorFor(userId: string, fallback?: string): string {
  if (fallback) return fallback;
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

function presenceCaret(p: CanvasPresence): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'whim-presence';
  wrap.style.setProperty('--presence-color', colorFor(p.userId, p.color));
  const bar = document.createElement('span');
  bar.className = 'whim-presence-bar';
  const label = document.createElement('span');
  label.className = 'whim-presence-label';
  label.textContent = p.status ? `${p.userId} · ${p.status}` : p.userId;
  wrap.appendChild(bar);
  wrap.appendChild(label);
  return wrap;
}

function buildSet(doc: ProseNode, presence: CanvasPresence[]): DecorationSet {
  if (presence.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  for (const p of presence) {
    if (!p.cursor || 'threadId' in p.cursor) continue; // thread-anchored presence is shown via comments
    const pos = resolveCaretAnchor(doc, p.cursor);
    if (pos == null) continue;
    const clamped = Math.max(0, Math.min(pos, doc.content.size));
    decos.push(
      Decoration.widget(clamped, () => presenceCaret(p), { side: 1, key: `presence-${p.userId}` }),
    );
  }
  return DecorationSet.create(doc, decos);
}

interface PresenceState {
  presence: CanvasPresence[];
  set: DecorationSet;
}

/** ProseMirror plugin: render remote agent presence carets (no Yjs/CRDT). */
export const presencePlugin = $prose(() => {
  return new Plugin<PresenceState>({
    key: presencePluginKey,
    state: {
      init: () => ({ presence: [], set: DecorationSet.empty }),
      apply(tr, value, _oldState, newState): PresenceState {
        return safePluginApply('presence', value, () => {
          const meta = tr.getMeta(SET_PRESENCE) as CanvasPresence[] | undefined;
          if (meta) {
            return { presence: meta, set: buildSet(newState.doc, meta) };
          }
          if (tr.docChanged && value.presence.length > 0) {
            return { presence: value.presence, set: buildSet(newState.doc, value.presence) };
          }
          return value;
        });
      },
    },
    props: {
      decorations(state) {
        return (presencePluginKey.getState(state) as PresenceState | undefined)?.set ?? DecorationSet.empty;
      },
    },
  });
});
