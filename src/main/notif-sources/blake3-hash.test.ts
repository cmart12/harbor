/**
 * Blake3 day-bucketed hashing utility tests (Phase C.1).
 */
import { describe, it, expect } from 'vitest';
import { contentHash, dayBucket } from './blake3-hash';

describe('blake3-hash', () => {
  describe('contentHash', () => {
    it('returns a 64-char hex string', () => {
      const h = contentHash('a', 'b', 'c');
      expect(h).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
    });

    it('is stable for the same input', () => {
      const h1 = contentHash('hello', 'world');
      const h2 = contentHash('hello', 'world');
      expect(h1).toBe(h2);
    });

    it('varies when any part changes', () => {
      const h1 = contentHash('hello', 'world');
      const h2 = contentHash('hello', 'world!');
      expect(h1).not.toBe(h2);
    });

    it('handles empty strings', () => {
      const h = contentHash('', '');
      expect(h).toHaveLength(64);
    });

    it('is order-sensitive', () => {
      const h1 = contentHash('a', 'b');
      const h2 = contentHash('b', 'a');
      expect(h1).not.toBe(h2);
    });
  });

  describe('dayBucket', () => {
    it('extracts YYYY-MM-DD from a full ISO string', () => {
      expect(dayBucket('2025-06-17T14:30:00Z')).toBe('2025-06-17');
    });

    it('extracts YYYY-MM-DD from a date-only string', () => {
      expect(dayBucket('2025-01-01')).toBe('2025-01-01');
    });

    it('handles timestamps with timezone offset', () => {
      expect(dayBucket('2025-06-17T14:30:00+05:00')).toBe('2025-06-17');
    });

    it('falls back to today for short/malformed input', () => {
      const today = new Date().toISOString().slice(0, 10);
      expect(dayBucket('2025')).toBe(today);
    });
  });
});
