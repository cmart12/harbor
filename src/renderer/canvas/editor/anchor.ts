import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { Anchor, TextAnchor, CommentThread } from '../types';

// Object-replacement char stands in for non-text inline leaves (images, mentions)
// so flattened text offsets stay roughly aligned with ProseMirror positions.
const OBJ = '\uFFFC';
const CONTEXT_LEN = 32;

export interface FlatDoc {
  text: string;
  /** map[i] = ProseMirror position of flattened-text char i. */
  map: number[];
}

/**
 * Flatten a document to plain text with a per-character position map. Text
 * blocks are separated by '\n'. This lets us resolve content-addressable
 * anchors (quote + prefix/suffix) back to ProseMirror ranges, self-repairing
 * after edits the way documint's quote matching did.
 */
export function flattenDoc(doc: ProseNode): FlatDoc {
  let text = '';
  const map: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText) {
      const t = node.text ?? '';
      for (let i = 0; i < t.length; i++) {
        text += t[i];
        map.push(pos + i);
      }
      return false;
    }
    if (node.isTextblock) {
      if (text.length > 0) {
        text += '\n';
        map.push(pos);
      }
      return true;
    }
    if (node.isInline && node.isLeaf) {
      text += OBJ;
      map.push(pos);
      return false;
    }
    return true;
  });

  return { text, map };
}

function offsetToPos(flat: FlatDoc, offset: number): number {
  if (offset <= 0) return flat.map[0] ?? 0;
  if (offset < flat.map.length) return flat.map[offset];
  const last = flat.map[flat.map.length - 1];
  return last === undefined ? 0 : last + 1;
}

/** Pick the occurrence of `quote` whose surrounding text best matches the anchor. */
function findBestOccurrence(text: string, quote: string, anchor: TextAnchor): number {
  if (!quote) return -1;
  const occurrences: number[] = [];
  let idx = text.indexOf(quote);
  while (idx !== -1) {
    occurrences.push(idx);
    idx = text.indexOf(quote, idx + 1);
    if (occurrences.length > 200) break;
  }
  if (occurrences.length === 0) return -1;
  if (occurrences.length === 1) return occurrences[0];

  const prefix = anchor.prefix ?? '';
  const suffix = anchor.suffix ?? '';
  let best = occurrences[0];
  let bestScore = -1;
  for (const o of occurrences) {
    let score = 0;
    if (prefix) {
      const before = text.slice(Math.max(0, o - prefix.length), o);
      if (before.endsWith(prefix)) score += prefix.length;
      else {
        // partial suffix match of prefix
        let k = 0;
        while (k < prefix.length && before[before.length - 1 - k] === prefix[prefix.length - 1 - k]) k++;
        score += k;
      }
    }
    if (suffix) {
      const after = text.slice(o + quote.length, o + quote.length + suffix.length);
      if (after.startsWith(suffix)) score += suffix.length;
      else {
        let k = 0;
        while (k < suffix.length && after[k] === suffix[k]) k++;
        score += k;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

export interface ResolvedRange {
  from: number;
  to: number;
}

/** Resolve a comment thread's quote/anchor to a ProseMirror range, or null. */
export function resolveThreadRange(doc: ProseNode, thread: CommentThread, flat?: FlatDoc): ResolvedRange | null {
  const f = flat ?? flattenDoc(doc);
  const s = findBestOccurrence(f.text, thread.quote, thread.anchor ?? {});
  if (s < 0) return null;
  const e = s + thread.quote.length;
  const from = offsetToPos(f, s);
  const to = offsetToPos(f, e);
  if (to <= from) return null;
  return { from, to };
}

/** Build a content-addressable anchor for a new selection range. */
export function computeAnchor(doc: ProseNode, from: number, to: number): { quote: string; anchor: TextAnchor } {
  const flat = flattenDoc(doc);
  // Locate the flattened offset for `from` (positions are monotonic in map).
  let s = -1;
  for (let i = 0; i < flat.map.length; i++) {
    if (flat.map[i] >= from) { s = i; break; }
  }
  if (s < 0) s = flat.map.length;
  const quote = doc.textBetween(from, to, '\n', OBJ);
  const prefix = flat.text.slice(Math.max(0, s - CONTEXT_LEN), s);
  const suffix = flat.text.slice(s + quote.length, s + quote.length + CONTEXT_LEN);
  return { quote, anchor: { kind: 'text', prefix, suffix } };
}

/** Resolve a presence cursor anchor to a single ProseMirror position, or null. */
export function resolveCaretAnchor(doc: ProseNode, anchor: Anchor | undefined): number | null {
  if (!anchor || 'threadId' in anchor) return null;
  const flat = flattenDoc(doc);
  if (anchor.prefix) {
    const idx = flat.text.lastIndexOf(anchor.prefix);
    if (idx >= 0) return offsetToPos(flat, idx + anchor.prefix.length);
  }
  if (anchor.suffix) {
    const idx = flat.text.indexOf(anchor.suffix);
    if (idx >= 0) return offsetToPos(flat, idx);
  }
  return null;
}
