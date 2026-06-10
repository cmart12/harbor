import * as yaml from 'js-yaml';

export interface ParsedFrontmatter<T extends Record<string, unknown> = Record<string, unknown>> {
  frontmatter: T;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function asFrontmatterRecord<T extends Record<string, unknown>>(value: unknown): T {
  return (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as T;
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns null when the document has a frontmatter block that is invalid YAML.
 */
export function tryParseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
  content: string
): ParsedFrontmatter<T> | null {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {} as T, body: content };
  }

  try {
    const parsed = yaml.load(match[1]);
    return {
      frontmatter: asFrontmatterRecord<T>(parsed),
      body: match[2],
    };
  } catch {
    return null;
  }
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Invalid YAML is treated as body content so callers can preserve the file.
 */
export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
  content: string
): ParsedFrontmatter<T> {
  return tryParseFrontmatter<T>(content) ?? { frontmatter: {} as T, body: content };
}

/**
 * Serialize frontmatter + body back to a markdown string with YAML frontmatter block.
 * If frontmatter is empty, returns just the body.
 */
export function serializeFrontmatter<T extends Record<string, unknown>>(
  frontmatter: T,
  body: string
): string {
  const keys = Object.keys(frontmatter).filter(k => frontmatter[k] !== undefined && frontmatter[k] !== null);
  if (keys.length === 0) {
    return body;
  }

  const clean: Record<string, unknown> = {};
  for (const k of keys) {
    clean[k] = frontmatter[k];
  }

  const yamlStr = yaml.dump(clean, {
    lineWidth: -1,
    quotingType: "'",
    forceQuotes: false,
  }).trimEnd();

  return `---\n${yamlStr}\n---\n${body}`;
}

/**
 * Check whether a markdown string has a frontmatter block.
 */
export function hasFrontmatter(content: string): boolean {
  return FRONTMATTER_RE.test(content);
}

/** Frontmatter keys managed by other UI (e.g. linked skill chips) — not shown in the editor. */
const MANAGED_FRONTMATTER_KEYS = new Set(['skills']);

/**
 * Whether a frontmatter object has any content worth surfacing in the frontmatter editor.
 * Managed keys (e.g. linked `skills`) and empty values are ignored, so a space whose only
 * frontmatter is linked skills (or none at all) won't surface the editor.
 */
export function hasDisplayableFrontmatter(frontmatter: Record<string, unknown>): boolean {
  return Object.keys(frontmatter).some((key) => {
    if (MANAGED_FRONTMATTER_KEYS.has(key)) return false;
    const value = frontmatter[key];
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
}
