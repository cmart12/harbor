import type { CommentThread } from '../types';

const COMMENTS_START = ':::whim-comments';
// Legacy marker written by the pre-Milkdown editor. Still read for backward
// compatibility; rewritten to COMMENTS_START on the next save.
const LEGACY_COMMENTS_START = ':::documint-comments';
// Matches the fenced comments directive block wherever it appears in the body,
// accepting both the current and legacy markers.
const COMMENTS_BLOCK_RE = /:::(?:whim|documint)-comments[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*\r?\n?/;

export interface SplitContent {
  body: string;
  threads: CommentThread[];
}

/**
 * Separate the editor body from the embedded `:::whim-comments` block.
 * The block is kept out of the WYSIWYG editor (which can't parse the directive)
 * and round-tripped on save by {@link joinComments}. The legacy
 * `:::documint-comments` marker is still recognized for backward compatibility
 * and is upgraded to `:::whim-comments` the next time the document is saved.
 */
export function splitComments(content: string): SplitContent {
  if (!content.includes(COMMENTS_START) && !content.includes(LEGACY_COMMENTS_START)) {
    return { body: content, threads: [] };
  }

  const match = content.match(COMMENTS_BLOCK_RE);
  if (!match) return { body: content, threads: [] };

  let threads: CommentThread[] = [];
  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) threads = parsed as CommentThread[];
  } catch {
    // Malformed block — leave it inline rather than dropping data.
    return { body: content, threads: [] };
  }

  const body = (content.slice(0, match.index) + content.slice((match.index ?? 0) + match[0].length)).replace(/\s+$/, '');
  return { body, threads };
}

/** Re-attach the comments block to the editor body for persistence. */
export function joinComments(body: string, threads: CommentThread[]): string {
  if (!threads || threads.length === 0) return body;
  const json = JSON.stringify(threads, null, 2);
  return `${body.replace(/\s+$/, '')}\n\n${COMMENTS_START}\n${json}\n:::\n`;
}

/** Extract @handles from a comment body that match the known mention roster. */
export function extractMentions(body: string, knownHandles: readonly string[]): string[] {
  if (!body) return [];
  const found = new Set<string>();
  const re = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const handle = m[2];
    if (knownHandles.includes(handle)) found.add(handle);
  }
  return [...found];
}

let threadCounter = 0;
/** Generate a stable-enough thread id. */
export function newThreadId(): string {
  threadCounter += 1;
  return `c-${Date.now().toString(36)}-${threadCounter.toString(36)}`;
}
