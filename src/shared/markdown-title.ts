import { parseFrontmatter, serializeFrontmatter } from './frontmatter';

export const DEFAULT_MARKDOWN_TITLE = 'Untitled';
export const MAX_SPACE_TITLE_LENGTH = 80;

export type MarkdownTitleKind = 'h1' | 'legacy-plain';

export interface MarkdownTitleInfo {
  title: string;
  kind: MarkdownTitleKind;
  lineIndex: number;
}

const H1_RE = /^#(?!#)\s+(.+?)\s*#*\s*$/;

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function truncateMarkdownTitle(title: string, maxLength = MAX_SPACE_TITLE_LENGTH): string {
  if (title.length <= maxLength) return title;
  if (maxLength <= 1) return title.slice(0, maxLength);
  return `${title.slice(0, maxLength - 1)}…`;
}

export function extractMarkdownTitleInfo(markdown: string): MarkdownTitleInfo | null {
  const { body } = parseFrontmatter(markdown);
  const lines = body.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (trimmed === ':::whim-comments' || trimmed === ':::documint-comments') return null;

    const h1 = trimmed.match(H1_RE);
    if (h1) {
      const title = normalizeTitle(h1[1]);
      return title ? { title, kind: 'h1', lineIndex: i } : null;
    }

    const legacyTitle = normalizeTitle(trimmed.replace(/^#+\s*/, ''));
    return legacyTitle ? { title: legacyTitle, kind: 'legacy-plain', lineIndex: i } : null;
  }

  return null;
}

export function deriveMarkdownTitle(
  markdown: string,
  fallback = DEFAULT_MARKDOWN_TITLE,
  maxLength = MAX_SPACE_TITLE_LENGTH,
): string {
  const title = extractMarkdownTitleInfo(markdown)?.title || normalizeTitle(fallback) || DEFAULT_MARKDOWN_TITLE;
  return truncateMarkdownTitle(title, maxLength);
}

export function formatMarkdownH1(title: string): string {
  const normalized = normalizeTitle(title) || DEFAULT_MARKDOWN_TITLE;
  return `# ${normalized}`;
}

export function ensureMarkdownH1Title(
  markdown: string,
  fallback = DEFAULT_MARKDOWN_TITLE,
): { content: string; title: string; changed: boolean } {
  const parsed = parseFrontmatter(markdown);
  const lines = parsed.body.split(/\r?\n/);
  const existing = extractMarkdownTitleInfo(markdown);
  const title = existing?.title || normalizeTitle(fallback) || DEFAULT_MARKDOWN_TITLE;

  if (existing?.kind === 'h1') {
    return { content: markdown, title, changed: false };
  }

  const h1 = formatMarkdownH1(title);
  let body: string;
  let changed = true;

  if (existing?.kind === 'legacy-plain') {
    lines[existing.lineIndex] = h1;
    body = lines.join('\n');
  } else if (parsed.body.trim().length === 0) {
    body = `${h1}\n`;
  } else {
    body = `${h1}\n\n${parsed.body}`;
  }

  const content = Object.keys(parsed.frontmatter).length > 0
    ? serializeFrontmatter(parsed.frontmatter, body)
    : body;

  if (content === markdown) changed = false;
  return { content, title, changed };
}
