import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter, hasFrontmatter, tryParseFrontmatter } from './frontmatter';

describe('frontmatter', () => {
  describe('parseFrontmatter', () => {
    it('parses valid YAML frontmatter', () => {
      const content = `---\nname: pdf-processing\ndescription: Extract text from PDFs\n---\n# Body\n\nHello`;
      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({ name: 'pdf-processing', description: 'Extract text from PDFs' });
      expect(result.body).toBe('# Body\n\nHello');
    });

    it('returns empty frontmatter when no frontmatter present', () => {
      const content = '# Just markdown\n\nNo frontmatter here.';
      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
    });

    it('handles empty frontmatter block', () => {
      const content = '---\n\n---\nBody here';
      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe('Body here');
    });

    it('handles frontmatter with extra fields', () => {
      const content = `---\nname: test\ntags:\n  - a\n  - b\n---\nBody`;
      const result = parseFrontmatter(content);
      expect(result.frontmatter.name).toBe('test');
      expect(result.frontmatter.tags).toEqual(['a', 'b']);
      expect(result.body).toBe('Body');
    });

    it('parses linked skill arrays', () => {
      const content = `---\nskills:\n  - missed-messages\n---\n# Missed Messages\n`;
      const result = parseFrontmatter(content);
      expect(result.frontmatter.skills).toEqual(['missed-messages']);
      expect(result.body).toBe('# Missed Messages\n');
    });

    it('handles invalid YAML gracefully', () => {
      const content = `---\n: broken: yaml: [unclosed\n---\nBody`;
      const result = parseFrontmatter(content);
      // Should treat as no frontmatter
      expect(result.body).toBe(content);
    });

    it('handles Windows line endings', () => {
      const content = '---\r\nname: test\r\n---\r\nBody';
      const result = parseFrontmatter(content);
      expect(result.frontmatter.name).toBe('test');
      expect(result.body).toBe('Body');
    });

    it('handles empty body', () => {
      const content = '---\nname: test\n---\n';
      const result = parseFrontmatter(content);
      expect(result.frontmatter.name).toBe('test');
      expect(result.body).toBe('');
    });
  });

  describe('serializeFrontmatter', () => {
    it('serializes frontmatter + body', () => {
      const result = serializeFrontmatter({ name: 'test', description: 'A test' }, '# Body\n');
      expect(result).toMatch(/^---\n/);
      expect(result).toContain('name: test');
      expect(result).toContain('description: A test');
      expect(result).toMatch(/---\n# Body\n$/);
    });

    it('returns just body when frontmatter is empty', () => {
      const result = serializeFrontmatter({}, '# Body\n');
      expect(result).toBe('# Body\n');
    });

    it('skips undefined/null values', () => {
      const result = serializeFrontmatter({ name: 'test', extra: undefined, other: null } as any, 'Body');
      expect(result).toContain('name: test');
      expect(result).not.toContain('extra');
      expect(result).not.toContain('other');
    });

    it('roundtrips through parse', () => {
      const original = { name: 'pdf-processing', description: 'Extract text from PDFs' };
      const body = '# PDF Processing\n\nHandles PDF files.\n';
      const serialized = serializeFrontmatter(original, body);
      const parsed = parseFrontmatter(serialized);
      expect(parsed.frontmatter.name).toBe('pdf-processing');
      expect(parsed.frontmatter.description).toBe('Extract text from PDFs');
      expect(parsed.body).toBe(body);
    });

    it('roundtrips array fields', () => {
      const serialized = serializeFrontmatter({ skills: ['missed-messages'] }, '# Missed Messages\n');
      const parsed = parseFrontmatter(serialized);
      expect(parsed.frontmatter.skills).toEqual(['missed-messages']);
      expect(parsed.body).toBe('# Missed Messages\n');
    });
  });

  describe('tryParseFrontmatter', () => {
    it('returns null for invalid YAML frontmatter', () => {
      const content = `---\n: broken: yaml: [unclosed\n---\nBody`;
      expect(tryParseFrontmatter(content)).toBeNull();
    });
  });

  describe('hasFrontmatter', () => {
    it('returns true for content with frontmatter', () => {
      expect(hasFrontmatter('---\nname: test\n---\nBody')).toBe(true);
    });

    it('returns false for content without frontmatter', () => {
      expect(hasFrontmatter('# Just markdown')).toBe(false);
    });

    it('returns false for content with only one delimiter', () => {
      expect(hasFrontmatter('---\nNot real frontmatter')).toBe(false);
    });
  });
});
