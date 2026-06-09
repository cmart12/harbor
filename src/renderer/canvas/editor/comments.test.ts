import { describe, it, expect } from 'vitest';
import { splitComments, joinComments, extractMentions } from './comments';
import type { CommentThread } from '../types';

const thread: CommentThread = {
  id: 'c-1',
  quote: 'the quick brown fox',
  comments: [{ body: 'needs work @alice', updatedAt: '2026-01-01T00:00:00.000Z' }],
  anchor: { kind: 'text', prefix: 'before ', suffix: ' after' },
};

describe('comments serialization', () => {
  it('returns the body unchanged when there is no comments block', () => {
    const { body, threads } = splitComments('# Title\n\nSome text.');
    expect(body).toBe('# Title\n\nSome text.');
    expect(threads).toEqual([]);
  });

  it('splits out an embedded :::documint-comments block', () => {
    const content = `# Doc\n\nBody text.\n\n:::documint-comments\n${JSON.stringify([thread], null, 2)}\n:::\n`;
    const { body, threads } = splitComments(content);
    expect(body).toBe('# Doc\n\nBody text.');
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('c-1');
    expect(threads[0].quote).toBe('the quick brown fox');
  });

  it('joinComments omits the block when there are no threads', () => {
    expect(joinComments('# Doc\n\nBody.', [])).toBe('# Doc\n\nBody.');
  });

  it('round-trips body + threads through join -> split', () => {
    const body = '# Doc\n\nBody text with detail.';
    const joined = joinComments(body, [thread]);
    expect(joined).toContain(':::documint-comments');
    const back = splitComments(joined);
    expect(back.body).toBe(body);
    expect(back.threads).toEqual([thread]);
  });

  it('preserves the documint marker for backward compatibility', () => {
    expect(joinComments('x', [thread])).toContain(':::documint-comments');
  });

  it('leaves malformed comment blocks inline rather than dropping data', () => {
    const content = '# Doc\n\n:::documint-comments\n{ not valid json\n:::\n';
    const { body, threads } = splitComments(content);
    expect(threads).toEqual([]);
    expect(body).toBe(content);
  });

  it('extracts @mentions that match the roster', () => {
    expect(extractMentions('hey @alice and @bob', ['alice', 'carol'])).toEqual(['alice']);
    expect(extractMentions('email me@example.com', ['me'])).toEqual([]);
    expect(extractMentions('@alice @alice', ['alice'])).toEqual(['alice']);
  });
});
