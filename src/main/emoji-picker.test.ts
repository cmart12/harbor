import { describe, it, expect } from 'vitest';
import { pickEmoji } from './emoji-picker';

describe('emoji-picker', () => {
  describe('keyword matching', () => {
    it('matches PDF-related skills', () => {
      expect(pickEmoji('PDF Processing', 'Handle PDF files')).toBe('📄');
    });

    it('matches code-related skills', () => {
      expect(pickEmoji('Code Review Helper', '')).toBe('💻');
    });

    it('matches deploy-related skills', () => {
      expect(pickEmoji('Auto Deploy', 'Deploy to production')).toBe('🚀');
    });

    it('matches test-related skills', () => {
      expect(pickEmoji('Test Generator', 'Generate unit tests')).toBe('🧪');
    });

    it('matches review-related skills via description', () => {
      expect(pickEmoji('PR Helper', 'Automate pull request review')).toBe('👀');
    });

    it('matches security-related skills', () => {
      expect(pickEmoji('Auth Setup', 'Configure authentication')).toBe('🔒');
    });

    it('matches email-related skills', () => {
      expect(pickEmoji('Email Drafter', '')).toBe('📧');
    });

    it('matches finance-related skills', () => {
      expect(pickEmoji('Expense Report', 'Track expenses and invoices')).toBe('💰');
    });

    it('matches bug/triage skills', () => {
      expect(pickEmoji('Issue Triage', 'Triage bugs')).toBe('🐛');
    });

    it('matches design skills', () => {
      expect(pickEmoji('UI Design', 'Create UI mockups')).toBe('🎨');
    });

    it('matches database skills', () => {
      expect(pickEmoji('SQL Helper', 'Write database queries')).toBe('🗃️');
    });

    it('matches API skills', () => {
      expect(pickEmoji('REST API Builder', '')).toBe('🔌');
    });

    it('matches git-related skills', () => {
      expect(pickEmoji('Git Commit Helper', '')).toBe('🌿');
    });

    it('matches container skills', () => {
      expect(pickEmoji('Docker Setup', '')).toBe('🐳');
    });

    it('matches first keyword when multiple could match', () => {
      // "code" comes before "test" in the keyword map
      const emoji = pickEmoji('Code Testing Framework', '');
      expect(emoji).toBe('💻');
    });
  });

  describe('word boundary matching', () => {
    it('does not match partial words', () => {
      // "document" should not match in "undocumented"
      // but our keyword "doc" would match "documentation" — that's expected behavior
      // Test that "api" doesn't match in "capital"
      const emoji = pickEmoji('Capital One Helper', 'Handle capital investments');
      expect(emoji).not.toBe('🔌');
    });
  });

  describe('hash fallback', () => {
    it('returns an emoji for unmatched skills', () => {
      const emoji = pickEmoji('My Unique Skill', 'Does something special');
      expect(typeof emoji).toBe('string');
      expect(emoji.length).toBeGreaterThan(0);
    });

    it('is deterministic — same input always returns same emoji', () => {
      const a = pickEmoji('Random Skill', '');
      const b = pickEmoji('Random Skill', '');
      expect(a).toBe(b);
    });

    it('produces different emojis for different names', () => {
      const emojis = new Set([
        pickEmoji('Alpha', ''),
        pickEmoji('Beta', ''),
        pickEmoji('Gamma', ''),
        pickEmoji('Delta', ''),
        pickEmoji('Epsilon', ''),
        pickEmoji('Zeta', ''),
      ]);
      // With 6 inputs and 24 palette entries, expect at least 2 distinct emojis
      expect(emojis.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('case insensitivity', () => {
    it('matches keywords regardless of case', () => {
      expect(pickEmoji('PDF PROCESSOR', '')).toBe('📄');
      expect(pickEmoji('pdf processor', '')).toBe('📄');
      expect(pickEmoji('Pdf Processor', '')).toBe('📄');
    });
  });
});
