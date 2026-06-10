import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

export const typingEffectsPluginKey = new PluginKey<TypingEffectsState>('whim-typing-effects');
export const SUPPRESS_TYPING_EFFECTS = 'whim-suppress-typing-effects';

const EXPIRE_TYPING_EFFECTS = 'whim-expire-typing-effects';
const INSERT_EFFECT_MS = 520;
const PULSE_EFFECT_MS = 620;
const FADE_EFFECT_MS = 560;
const MAX_INSERT_CHARS = 160;
const MAX_INSERT_EFFECTS = 12;
const MAX_FADE_CHARS = 2;
const objectReplacementChar = '\uFFFC';
const emojiPattern = /\p{Extended_Pictographic}/u;

type InsertEffect = {
  id: string;
  kind: 'insert';
  from: number;
  to: number;
  pulse: boolean;
  expiresAt: number;
};

type FadeEffect = {
  id: string;
  kind: 'fade';
  pos: number;
  text: string;
  expiresAt: number;
};

type TypingEffect = InsertEffect | FadeEffect;

interface TypingEffectsState {
  effects: TypingEffect[];
  set: DecorationSet;
  suppressNextDocChange: boolean;
}

let nextEffectId = 0;

function createEffectId(kind: TypingEffect['kind']): string {
  nextEffectId += 1;
  return `whim-${kind}-${Date.now()}-${nextEffectId}`;
}

function clampPos(pos: number, doc: ProseNode): number {
  return Math.max(0, Math.min(pos, doc.content.size));
}

function containsColorEmoji(text: string): boolean {
  return emojiPattern.test(text) || /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text);
}

function shouldAnimateText(text: string, maxChars: number): boolean {
  if (text.length === 0 || text.length > maxChars) return false;
  if (text.trim().length === 0) return false;
  if (text.includes('\n') || text.includes(objectReplacementChar)) return false;
  return !containsColorEmoji(text);
}

function hasCodeContext(doc: ProseNode, from: number, to: number): boolean {
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    const nodeName = node.type.name.toLowerCase();
    if (nodeName.includes('code')) {
      found = true;
      return false;
    }
    if (node.marks.some((mark) => mark.type.name.toLowerCase().includes('code'))) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

function isSingleTextblockRange(doc: ProseNode, from: number, to: number): boolean {
  if (from >= to) return false;
  try {
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    return $from.sameParent($to) && $from.parent.isTextblock;
  } catch {
    return false;
  }
}

function isFadePositionAtTextEnd(doc: ProseNode, pos: number): boolean {
  try {
    const $pos = doc.resolve(pos);
    if (!$pos.parent.isTextblock) return false;
    const textAfter = $pos.parent.textBetween(
      $pos.parentOffset,
      Math.min($pos.parent.content.size, $pos.parentOffset + 1),
      undefined,
      objectReplacementChar,
    );
    return textAfter.length === 0;
  } catch {
    return false;
  }
}

function fadeWidget(effect: FadeEffect): HTMLElement {
  const span = document.createElement('span');
  span.className = 'whim-typing-fade';
  span.textContent = effect.text;
  span.contentEditable = 'false';
  span.setAttribute('aria-hidden', 'true');
  return span;
}

function buildSet(doc: ProseNode, effects: readonly TypingEffect[]): DecorationSet {
  if (effects.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  for (const effect of effects) {
    if (effect.kind === 'insert') {
      if (effect.from >= effect.to) continue;
      decorations.push(
        Decoration.inline(
          effect.from,
          effect.to,
          { class: effect.pulse ? 'whim-typing-highlight whim-typing-pulse' : 'whim-typing-highlight' },
          { inclusiveStart: false, inclusiveEnd: false },
        ),
      );
      continue;
    }

    decorations.push(
      Decoration.widget(effect.pos, () => fadeWidget(effect), {
        key: effect.id,
        side: -1,
      }),
    );
  }

  return DecorationSet.create(doc, decorations);
}

function addInsertEffect(
  effects: TypingEffect[],
  doc: ProseNode,
  from: number,
  to: number,
  now: number,
): void {
  if (effects.length >= MAX_INSERT_EFFECTS) return;
  if (from >= to) return;

  const text = doc.textBetween(from, to, '', objectReplacementChar);
  if (!shouldAnimateText(text, MAX_INSERT_CHARS)) return;
  if (hasCodeContext(doc, from, to)) return;

  const pulse = text === '.';
  effects.push({
    id: createEffectId('insert'),
    kind: 'insert',
    from,
    to,
    pulse,
    expiresAt: now + (pulse ? PULSE_EFFECT_MS : INSERT_EFFECT_MS),
  });
}

function collectInsertEffectsForRange(
  effects: TypingEffect[],
  doc: ProseNode,
  from: number,
  to: number,
  now: number,
): void {
  if (isSingleTextblockRange(doc, from, to)) {
    addInsertEffect(effects, doc, from, to, now);
    return;
  }

  doc.nodesBetween(from, to, (node, pos) => {
    if (effects.length >= MAX_INSERT_EFFECTS) return false;
    if (!node.isTextblock) return undefined;

    const blockFrom = Math.max(from, pos + 1);
    const blockTo = Math.min(to, pos + node.nodeSize - 1);
    addInsertEffect(effects, doc, blockFrom, blockTo, now);
    return false;
  });
}

function mapEffect(effect: TypingEffect, tr: Transaction, doc: ProseNode): TypingEffect | null {
  if (!tr.docChanged) return effect;

  if (effect.kind === 'insert') {
    const from = tr.mapping.map(effect.from, 1);
    const to = tr.mapping.map(effect.to, -1);
    if (from >= to) return null;
    return { ...effect, from: clampPos(from, doc), to: clampPos(to, doc) };
  }

  return { ...effect, pos: clampPos(tr.mapping.map(effect.pos, -1), doc) };
}

function collectInsertionEffects(
  tr: Transaction,
  newState: EditorState,
  now: number,
): TypingEffect[] {
  const doc = newState.doc;
  const effects: TypingEffect[] = [];
  const seenRanges = new Set<string>();

  tr.mapping.maps.forEach((map, index) => {
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      if (newEnd <= newStart) return;

      const remaining = tr.mapping.slice(index + 1);
      const from = clampPos(remaining.map(newStart, 1), doc);
      const to = clampPos(remaining.map(newEnd, -1), doc);
      const key = `${from}:${to}`;
      if (seenRanges.has(key)) return;
      seenRanges.add(key);

      collectInsertEffectsForRange(effects, doc, from, to, now);
    });
  });

  return effects;
}

function collectFadeEffects(
  tr: Transaction,
  oldState: EditorState,
  newState: EditorState,
  now: number,
): TypingEffect[] {
  if (tr.mapping.maps.length !== 1) return [];

  const effects: TypingEffect[] = [];
  tr.mapping.maps[0]?.forEach((oldStart, oldEnd, newStart, newEnd) => {
    if (oldEnd <= oldStart || newStart !== newEnd) return;

    const text = oldState.doc.textBetween(oldStart, oldEnd, '', objectReplacementChar);
    if (!shouldAnimateText(text, MAX_FADE_CHARS)) return;
    if (hasCodeContext(oldState.doc, oldStart, oldEnd)) return;

    const pos = clampPos(newStart, newState.doc);
    if (!isFadePositionAtTextEnd(newState.doc, pos)) return;

    effects.push({
      id: createEffectId('fade'),
      kind: 'fade',
      pos,
      text,
      expiresAt: now + FADE_EFFECT_MS,
    });
  });
  return effects;
}

function collectNewEffects(
  tr: Transaction,
  oldState: EditorState,
  newState: EditorState,
): TypingEffect[] {
  if (tr.getMeta('uiEvent') === 'paste' || tr.getMeta('uiEvent') === 'drop') return [];

  const now = Date.now();
  return [
    ...collectInsertionEffects(tr, newState, now),
    ...collectFadeEffects(tr, oldState, newState, now),
  ];
}

function scheduleEffectExpiry(view: EditorView, scheduled: Map<string, number>) {
  const state = typingEffectsPluginKey.getState(view.state);
  const activeIds = new Set((state?.effects ?? []).map((effect) => effect.id));

  for (const [id, timeoutId] of scheduled) {
    if (!activeIds.has(id)) {
      window.clearTimeout(timeoutId);
      scheduled.delete(id);
    }
  }

  for (const effect of state?.effects ?? []) {
    if (scheduled.has(effect.id)) continue;

    const timeoutId = window.setTimeout(() => {
      scheduled.delete(effect.id);
      try {
        view.dispatch(
          view.state.tr
            .setMeta(EXPIRE_TYPING_EFFECTS, [effect.id])
            .setMeta('addToHistory', false),
        );
      } catch {
        // The Milkdown view can be torn down while an animation timer is pending.
      }
    }, Math.max(0, effect.expiresAt - Date.now()));
    scheduled.set(effect.id, timeoutId);
  }
}

export const typingEffectsPlugin = $prose(() => {
  return new Plugin<TypingEffectsState>({
    key: typingEffectsPluginKey,
    state: {
      init: () => ({
        effects: [],
        set: DecorationSet.empty,
        suppressNextDocChange: false,
      }),
      apply(tr, value, oldState, newState): TypingEffectsState {
        const suppressMeta = tr.getMeta(SUPPRESS_TYPING_EFFECTS) as boolean | undefined;
        const expireIds = tr.getMeta(EXPIRE_TYPING_EFFECTS) as string[] | undefined;
        const expired = new Set(expireIds ?? []);
        const suppressThisDocChange =
          tr.docChanged && (value.suppressNextDocChange || suppressMeta === true);

        let suppressNextDocChange = value.suppressNextDocChange;
        if (suppressMeta !== undefined) suppressNextDocChange = suppressMeta;

        if (suppressThisDocChange) {
          return {
            effects: [],
            set: DecorationSet.empty,
            suppressNextDocChange: false,
          };
        }

        const mapped = value.effects
          .filter((effect) => !expired.has(effect.id))
          .map((effect) => mapEffect(effect, tr, newState.doc))
          .filter((effect): effect is TypingEffect => effect !== null);
        const effects = tr.docChanged
          ? [...mapped, ...collectNewEffects(tr, oldState, newState)]
          : mapped;

        return {
          effects,
          set: buildSet(newState.doc, effects),
          suppressNextDocChange,
        };
      },
    },
    props: {
      decorations(state) {
        return (typingEffectsPluginKey.getState(state) as TypingEffectsState | undefined)?.set ?? DecorationSet.empty;
      },
    },
    view(view) {
      const scheduled = new Map<string, number>();
      scheduleEffectExpiry(view, scheduled);

      return {
        update(nextView) {
          scheduleEffectExpiry(nextView, scheduled);
        },
        destroy() {
          for (const timeoutId of scheduled.values()) {
            window.clearTimeout(timeoutId);
          }
          scheduled.clear();
        },
      };
    },
  });
});
