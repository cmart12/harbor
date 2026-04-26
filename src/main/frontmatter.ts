import * as yaml from 'js-yaml';

export interface ParsedFrontmatter<T extends Record<string, unknown> = Record<string, unknown>> {
  frontmatter: T;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns the parsed frontmatter object and the remaining body.
 * If no frontmatter is found, returns an empty object and the full content as body.
 */
export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
  content: string
): ParsedFrontmatter<T> {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {} as T, body: content };
  }

  try {
    const parsed = yaml.load(match[1]) as T;
    return {
      frontmatter: (parsed && typeof parsed === 'object' ? parsed : {}) as T,
      body: match[2],
    };
  } catch {
    // Invalid YAML — treat entire content as body
    return { frontmatter: {} as T, body: content };
  }
}

/**
 * Serialize frontmatter + body back to a markdown string with YAML frontmatter block.
 * If frontmatter is empty, returns just the body (no frontmatter block).
 */
export function serializeFrontmatter<T extends Record<string, unknown>>(
  frontmatter: T,
  body: string
): string {
  const keys = Object.keys(frontmatter).filter(k => frontmatter[k] !== undefined && frontmatter[k] !== null);
  if (keys.length === 0) {
    return body;
  }

  // Build a clean object with only defined values
  const clean: Record<string, unknown> = {};
  for (const k of keys) {
    clean[k] = frontmatter[k];
  }

  const yamlStr = yaml.dump(clean, {
    lineWidth: -1,  // no wrapping
    quotingType: "'",
    forceQuotes: false,
  }).trimEnd();

  return `---\n${yamlStr}\n---\n${body}`;
}

/**
 * Check whether a markdown string has frontmatter.
 */
export function hasFrontmatter(content: string): boolean {
  return FRONTMATTER_RE.test(content);
}
