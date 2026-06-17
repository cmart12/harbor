/**
 * Slack prompt builder + parser unit tests (Phase C.4).
 *
 * Tests buildSlackPrompt, extractJsonArray, and parseSlackItems
 * exported from the worker. Mirrors workiq-prompt.test.ts structure.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSlackPrompt,
  extractJsonArray,
  parseSlackItems,
  type SlackItem,
} from './slack-worker';

// ---------------------------------------------------------------------------
// buildSlackPrompt
// ---------------------------------------------------------------------------
describe('buildSlackPrompt', () => {
  it('includes the since cursor when provided', () => {
    const prompt = buildSlackPrompt('2026-06-16T00:00:00Z');
    expect(prompt).toContain('2026-06-16T00:00:00Z');
    expect(prompt).toContain('since');
  });

  it('embeds a backfill cursor when provided as a 24-hour-ago ISO string', () => {
    const backfillCursor = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const prompt = buildSlackPrompt(backfillCursor);
    expect(prompt).toContain(backfillCursor);
    expect(prompt).toContain('since');
  });

  it('requests mentions and DMs', () => {
    const prompt = buildSlackPrompt('2026-06-16T00:00:00Z');
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/mention|@/);
    expect(lower).toMatch(/dm|direct message/);
  });

  it('requests JSON array output', () => {
    const prompt = buildSlackPrompt('2026-06-16T00:00:00Z');
    expect(prompt).toContain('JSON');
  });

  it('includes source_uid in the schema', () => {
    const prompt = buildSlackPrompt('2026-06-16T00:00:00Z');
    expect(prompt).toContain('source_uid');
  });

  it('includes channel_id and thread_ts in the schema', () => {
    const prompt = buildSlackPrompt('2026-06-16T00:00:00Z');
    expect(prompt).toContain('channel_id');
    expect(prompt).toContain('thread_ts');
  });

  it('includes deep_link in the schema', () => {
    const prompt = buildSlackPrompt('2026-06-16T00:00:00Z');
    expect(prompt).toContain('deep_link');
  });

  it('specifies source as "slack"', () => {
    const prompt = buildSlackPrompt('2026-06-16T00:00:00Z');
    expect(prompt).toContain('"slack"');
  });
});

// ---------------------------------------------------------------------------
// extractJsonArray
// ---------------------------------------------------------------------------
describe('extractJsonArray', () => {
  it('extracts a bare JSON array', () => {
    const raw = '[{"source":"slack","source_uid":"a"}]';
    const result = extractJsonArray(raw);
    expect(result).toHaveLength(1);
    expect(result![0].source).toBe('slack');
  });

  it('extracts JSON wrapped in a markdown code block', () => {
    const raw = '```json\n[{"source":"slack","source_uid":"a"}]\n```';
    const result = extractJsonArray(raw);
    expect(result).toHaveLength(1);
  });

  it('returns null for prose with no JSON', () => {
    const result = extractJsonArray('No new notifications found.');
    expect(result).toBeNull();
  });

  it('extracts JSON embedded in surrounding prose', () => {
    const raw = 'Here are your notifications:\n[{"source":"slack","source_uid":"a"}]\nEnd of results.';
    const result = extractJsonArray(raw);
    expect(result).toHaveLength(1);
  });

  it('handles empty JSON array', () => {
    const result = extractJsonArray('[]');
    expect(result).toEqual([]);
  });

  it('handles whitespace around the array', () => {
    const result = extractJsonArray('  \n  [{"source":"slack","source_uid":"a"}]  \n  ');
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// parseSlackItems
// ---------------------------------------------------------------------------
describe('parseSlackItems', () => {
  const validItem: SlackItem = {
    source: 'slack',
    source_uid: 'slack-uid-1',
    sender_name: 'Alice',
    sender_email: 'alice@example.com',
    subject: '#general',
    body: 'Hey team, take a look at this PR',
    received_at: '2026-06-17T10:00:00Z',
    deep_link: 'https://app.slack.com/archives/C01/p1718618400',
    channel_id: 'C01234',
    thread_ts: '1718618400.000100',
  };

  it('accepts a valid item with all fields', () => {
    const result = parseSlackItems([validItem]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('slack');
    expect(result[0].channel_id).toBe('C01234');
    expect(result[0].thread_ts).toBe('1718618400.000100');
  });

  it('accepts items with null channel_id and thread_ts', () => {
    const result = parseSlackItems([{
      ...validItem,
      channel_id: null,
      thread_ts: null,
    }]);
    expect(result).toHaveLength(1);
    expect(result[0].channel_id).toBeNull();
    expect(result[0].thread_ts).toBeNull();
  });

  it('coerces undefined optional fields to null', () => {
    const { channel_id: _ch, thread_ts: _ts, sender_email: _se, deep_link: _dl, ...minimal } = validItem;
    const result = parseSlackItems([minimal as SlackItem]);
    expect(result).toHaveLength(1);
    expect(result[0].channel_id).toBeNull();
    expect(result[0].thread_ts).toBeNull();
  });

  it('generates a hash-based uid when source_uid is absent', () => {
    const { source_uid: _uid, ...noUid } = validItem;
    const result = parseSlackItems([noUid as SlackItem]);
    expect(result).toHaveLength(1);
    // Fallback hash: (source, sender_name, bodyPrefix100, day)
    expect(result[0].source_uid).toBeTruthy();
    expect(result[0].source_uid).not.toBe(validItem.source_uid);
  });

  it('rejects items with wrong source', () => {
    const result = parseSlackItems([{ ...validItem, source: 'outlook' }]);
    expect(result).toHaveLength(0);
  });

  it('handles mixed valid and invalid items', () => {
    const badItem = { ...validItem, source: 'wrong', source_uid: 'b' };
    const result = parseSlackItems([validItem, badItem as SlackItem]);
    expect(result).toHaveLength(1);
    // Parser generates hash-based uid from channel_id + raw uid
    expect(result[0].source).toBe('slack');
  });

  it('returns empty array for empty input', () => {
    expect(parseSlackItems([])).toEqual([]);
  });

  it('preserves deep_link with slack:// URL scheme', () => {
    const item = { ...validItem, deep_link: 'slack://channel?id=C01&message=1234' };
    const result = parseSlackItems([item]);
    expect(result[0].deep_link).toBe('slack://channel?id=C01&message=1234');
  });

  it('accepts items with empty sender_email', () => {
    const item = { ...validItem, sender_email: '' };
    const result = parseSlackItems([item]);
    expect(result).toHaveLength(1);
  });

  it('coerces non-string body to null', () => {
    const item = { ...validItem, body: 123 };
    const result = parseSlackItems([item as unknown as SlackItem]);
    expect(result).toHaveLength(1);
    expect(result[0].body).toBeNull();
  });

  it('coerces null sender_name to null', () => {
    const item = { ...validItem, sender_name: null };
    const result = parseSlackItems([item as unknown as SlackItem]);
    expect(result).toHaveLength(1);
    expect(result[0].sender_name).toBeNull();
  });
});
