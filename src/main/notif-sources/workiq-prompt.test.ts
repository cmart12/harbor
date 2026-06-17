/**
 * WorkIQ worker pure-function tests (Phase C.1).
 *
 * Tests prompt construction, JSON array extraction, and item parsing
 * without importing any SDK or worker_threads machinery.
 */
import { describe, it, expect, vi } from 'vitest';

// Worker no longer imports electron/ai — only worker_threads and blake3-hash.
vi.mock('worker_threads', () => ({
  parentPort: null,
}));
vi.mock('./blake3-hash', () => ({
  contentHash: (...parts: string[]) => parts.join('|').padEnd(64, '0').slice(0, 64),
  dayBucket: (iso: string) => iso.slice(0, 10),
}));

import { buildWorkIQPrompt, extractJsonArray, parseWorkIQItems } from './workiq-worker';

// ---------------------------------------------------------------------------
// buildWorkIQPrompt
// ---------------------------------------------------------------------------

describe('buildWorkIQPrompt', () => {
  it('includes the cursor ISO timestamp', () => {
    const prompt = buildWorkIQPrompt('2025-06-10T00:00:00Z');
    expect(prompt).toContain('2025-06-10T00:00:00Z');
  });

  it('requests JSON array output', () => {
    const prompt = buildWorkIQPrompt('2025-06-10T00:00:00Z');
    expect(prompt.toLowerCase()).toContain('json');
    expect(prompt).toContain('source');
  });

  it('mentions both workiq-outlook and workiq-teams', () => {
    const prompt = buildWorkIQPrompt('2025-06-10T00:00:00Z');
    expect(prompt).toContain('workiq-outlook');
    expect(prompt).toContain('workiq-teams');
  });
});

// ---------------------------------------------------------------------------
// extractJsonArray
// ---------------------------------------------------------------------------

describe('extractJsonArray', () => {
  it('extracts a plain JSON array', () => {
    const text = '[{"a":1},{"b":2}]';
    const result = extractJsonArray(text);
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('extracts an array from markdown fenced code block', () => {
    const text = '```json\n[{"a":1}]\n```';
    const result = extractJsonArray(text);
    expect(result).toEqual([{ a: 1 }]);
  });

  it('extracts array surrounded by prose', () => {
    const text = 'Here are the results:\n[{"source":"workiq-outlook"}]\nEnd.';
    const result = extractJsonArray(text);
    expect(result).toEqual([{ source: 'workiq-outlook' }]);
  });

  it('returns null for empty text', () => {
    expect(extractJsonArray('')).toBeNull();
  });

  it('returns null for text with no array', () => {
    expect(extractJsonArray('No results found.')).toBeNull();
  });

  it('returns null for an object (not array)', () => {
    expect(extractJsonArray('{"a":1}')).toBeNull();
  });

  it('handles empty array', () => {
    expect(extractJsonArray('[]')).toEqual([]);
  });

  it('handles nested brackets in strings', () => {
    const text = '[{"subject":"test [important]"}]';
    const result = extractJsonArray(text);
    expect(result).toEqual([{ subject: 'test [important]' }]);
  });
});

// ---------------------------------------------------------------------------
// parseWorkIQItems
// ---------------------------------------------------------------------------

describe('parseWorkIQItems', () => {
  const validOutlook = {
    source: 'workiq-outlook',
    source_uid: 'msg-123',
    sender_name: 'Alice',
    sender_email: 'alice@example.com',
    subject: 'Re: Project update',
    body: 'Updated the docs.',
    received_at: '2025-06-17T10:00:00Z',
    deep_link: 'https://outlook.office.com/mail/id/123',
  };

  const validTeams = {
    source: 'workiq-teams',
    source_uid: 'chat-456',
    sender_name: 'Bob',
    sender_email: 'bob@example.com',
    subject: 'General chat',
    body: 'Check this out',
    received_at: '2025-06-17T11:00:00Z',
    deep_link: 'https://teams.microsoft.com/msg/456',
  };

  it('parses valid outlook item', () => {
    const items = parseWorkIQItems([validOutlook]);
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('workiq-outlook');
    // source_uid is a hash-based ID, not the raw source_uid
    expect(typeof items[0].source_uid).toBe('string');
    expect(items[0].source_uid.length).toBeGreaterThan(0);
  });

  it('parses valid teams item', () => {
    const items = parseWorkIQItems([validTeams]);
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('workiq-teams');
  });

  it('parses mixed items', () => {
    const items = parseWorkIQItems([validOutlook, validTeams]);
    expect(items).toHaveLength(2);
    expect(items[0].source).toBe('workiq-outlook');
    expect(items[1].source).toBe('workiq-teams');
  });

  it('skips items with invalid source', () => {
    const bad = { ...validOutlook, source: 'invalid-source' };
    const items = parseWorkIQItems([bad, validTeams]);
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('workiq-teams');
  });

  it('skips non-object entries', () => {
    const items = parseWorkIQItems(['not an object', 42, null, validOutlook]);
    expect(items).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(parseWorkIQItems([])).toEqual([]);
  });

  it('assigns stable source_uid (same item produces same hash)', () => {
    const items1 = parseWorkIQItems([validOutlook]);
    const items2 = parseWorkIQItems([validOutlook]);
    expect(items1[0].source_uid).toBe(items2[0].source_uid);
  });

  it('assigns different source_uid for different items', () => {
    const items = parseWorkIQItems([validOutlook, validTeams]);
    expect(items[0].source_uid).not.toBe(items[1].source_uid);
  });

  it('handles missing optional fields gracefully', () => {
    const minimal = {
      source: 'workiq-outlook',
      source_uid: 'min-1',
      sender_name: 'Test',
      subject: 'Sub',
      body: 'Body',
      received_at: '2025-06-17T10:00:00Z',
    };
    const items = parseWorkIQItems([minimal]);
    expect(items).toHaveLength(1);
    expect(items[0].deep_link).toBeNull();
    expect(items[0].sender_email).toBeNull();
  });
});
