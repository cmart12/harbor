import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKDOWN_TITLE,
  deriveMarkdownTitle,
  ensureMarkdownH1Title,
  extractMarkdownTitleInfo,
} from './markdown-title';

describe('markdown title helpers', () => {
  it('extracts the first non-empty H1 after frontmatter', () => {
    const markdown = '---\nskills:\n  - demo\n---\n\n# Project Brief\n\nBody';

    expect(extractMarkdownTitleInfo(markdown)).toEqual({
      title: 'Project Brief',
      kind: 'h1',
      lineIndex: 1,
    });
    expect(deriveMarkdownTitle(markdown)).toBe('Project Brief');
  });

  it('normalizes whitespace and trailing heading markers', () => {
    expect(deriveMarkdownTitle('#   A    spaced title   ###\nBody')).toBe('A spaced title');
  });

  it('uses the first non-empty plain line as a legacy fallback', () => {
    expect(extractMarkdownTitleInfo('\nLegacy title\nBody')).toEqual({
      title: 'Legacy title',
      kind: 'legacy-plain',
      lineIndex: 1,
    });
  });

  it('falls back for empty or comments-only documents', () => {
    expect(deriveMarkdownTitle('', 'Fallback')).toBe('Fallback');
    expect(deriveMarkdownTitle(':::whim-comments\n[]\n:::', 'Fallback')).toBe('Fallback');
    expect(deriveMarkdownTitle('', '')).toBe(DEFAULT_MARKDOWN_TITLE);
  });

  it('truncates derived display titles', () => {
    const title = 'A'.repeat(100);
    expect(deriveMarkdownTitle(`# ${title}`)).toBe(`${'A'.repeat(79)}…`);
  });

  it('leaves canonical H1 content unchanged', () => {
    const content = '# Existing\n\nBody';
    expect(ensureMarkdownH1Title(content)).toEqual({
      content,
      title: 'Existing',
      changed: false,
    });
  });

  it('promotes legacy first lines to canonical H1 content', () => {
    expect(ensureMarkdownH1Title('Legacy\n\nBody')).toEqual({
      content: '# Legacy\n\nBody',
      title: 'Legacy',
      changed: true,
    });
  });

  it('seeds empty content with an H1 fallback', () => {
    expect(ensureMarkdownH1Title('', 'New Space')).toEqual({
      content: '# New Space\n',
      title: 'New Space',
      changed: true,
    });
  });
});
