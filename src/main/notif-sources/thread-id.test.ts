import { describe, it, expect } from 'vitest';
import {
  normalizeSubject,
  macosThreadId,
  workiqOutlookThreadId,
  workiqTeamsThreadId,
  slackThreadId,
} from './thread-id';

describe('normalizeSubject', () => {
  it('strips a single Re: prefix', () => {
    expect(normalizeSubject('Re: Hello')).toBe('Hello');
  });

  it('strips a single Fwd: prefix', () => {
    expect(normalizeSubject('Fwd: Hello')).toBe('Hello');
  });

  it('strips FW: prefix (uppercase)', () => {
    expect(normalizeSubject('FW: Budget')).toBe('Budget');
  });

  it('strips repeated Re: Fwd: chains', () => {
    expect(normalizeSubject('Re: Fwd: Re: Meeting notes')).toBe('Meeting notes');
  });

  it('is case-insensitive', () => {
    expect(normalizeSubject('RE: FWD: re: topic')).toBe('topic');
  });

  it('handles leading/trailing whitespace', () => {
    expect(normalizeSubject('  Re:  Hello  ')).toBe('Hello');
  });

  it('returns trimmed string when no prefix present', () => {
    expect(normalizeSubject('  Hello World  ')).toBe('Hello World');
  });

  it('handles empty string', () => {
    expect(normalizeSubject('')).toBe('');
  });

  it('handles subject that is only prefixes', () => {
    expect(normalizeSubject('Re: Fwd: ')).toBe('');
  });

  it('does not strip Re in the middle of a word', () => {
    expect(normalizeSubject('Regular meeting')).toBe('Regular meeting');
  });

  it('handles unicode subjects', () => {
    expect(normalizeSubject('Re: Fwd: \u2603 snow day')).toBe('\u2603 snow day');
  });

  it('handles Fwd with mixed case and extra spaces', () => {
    expect(normalizeSubject('fWd:   lots of spaces')).toBe('lots of spaces');
  });
});

describe('macosThreadId', () => {
  it('uses app_id when present', () => {
    expect(macosThreadId('com.apple.MobileSMS')).toBe('macos:com.apple.MobileSMS');
  });

  it('falls back to unknown when app_id is null', () => {
    expect(macosThreadId(null)).toBe('macos:unknown');
  });

  it('returns deterministic value for the same app_id', () => {
    expect(macosThreadId('com.slack.Slack')).toBe(macosThreadId('com.slack.Slack'));
  });
});

describe('workiqOutlookThreadId', () => {
  it('uses conversation_id when present', () => {
    expect(workiqOutlookThreadId({
      conversation_id: 'AAQkAGI2TG93AAA=',
      sender_email: 'alice@example.com',
      subject: 'Re: Budget review',
    })).toBe('workiq-outlook:AAQkAGI2TG93AAA=');
  });

  it('falls back to sender_email:normalizeSubject when no conversation_id', () => {
    expect(workiqOutlookThreadId({
      conversation_id: null,
      sender_email: 'alice@example.com',
      subject: 'Re: Budget review',
    })).toBe('workiq-outlook:alice@example.com:Budget review');
  });

  it('falls back with empty conversation_id string', () => {
    expect(workiqOutlookThreadId({
      conversation_id: '',
      sender_email: 'bob@test.com',
      subject: 'Fwd: Plans',
    })).toBe('workiq-outlook:bob@test.com:Plans');
  });

  it('uses unknown sender when sender_email is null', () => {
    expect(workiqOutlookThreadId({
      sender_email: null,
      subject: 'Hello',
    })).toBe('workiq-outlook:unknown:Hello');
  });

  it('normalizes subject in fallback path', () => {
    expect(workiqOutlookThreadId({
      sender_email: 'a@b.com',
      subject: 'Re: Fwd: Re: topic',
    })).toBe('workiq-outlook:a@b.com:topic');
  });

  it('handles null subject in fallback', () => {
    expect(workiqOutlookThreadId({
      sender_email: 'a@b.com',
      subject: null,
    })).toBe('workiq-outlook:a@b.com:');
  });
});

describe('workiqTeamsThreadId', () => {
  it('uses channel_id + thread_id_from_response when both present', () => {
    expect(workiqTeamsThreadId({
      channel_id: '19:abc@thread.tacv2',
      thread_id_from_response: '1718900000000',
      sender_name: 'Alice',
      subject: 'General',
    })).toBe('workiq-teams:19:abc@thread.tacv2:1718900000000');
  });

  it('falls back when only channel_id present (no thread_id)', () => {
    expect(workiqTeamsThreadId({
      channel_id: '19:abc@thread.tacv2',
      thread_id_from_response: null,
      sender_name: 'Alice',
      subject: 'Re: General chat',
    })).toBe('workiq-teams:Alice:General chat');
  });

  it('falls back when only thread_id present (no channel_id)', () => {
    expect(workiqTeamsThreadId({
      channel_id: null,
      thread_id_from_response: '1718900000000',
      sender_name: 'Bob',
      subject: 'Design review',
    })).toBe('workiq-teams:Bob:Design review');
  });

  it('falls back to sender_name:subject when neither present', () => {
    expect(workiqTeamsThreadId({
      sender_name: 'Charlie',
      subject: 'FW: Standup notes',
    })).toBe('workiq-teams:Charlie:Standup notes');
  });

  it('uses unknown sender when sender_name is null', () => {
    expect(workiqTeamsThreadId({
      sender_name: null,
      subject: 'Hello',
    })).toBe('workiq-teams:unknown:Hello');
  });

  it('normalizes subject in fallback', () => {
    expect(workiqTeamsThreadId({
      sender_name: 'Dana',
      subject: 'Re: Fwd: sprint planning',
    })).toBe('workiq-teams:Dana:sprint planning');
  });
});

// ---------------------------------------------------------------------------
// slackThreadId
// ---------------------------------------------------------------------------

describe('slackThreadId', () => {
  it('uses channel_id when present', () => {
    expect(slackThreadId({
      channel_id: 'C01234ABC',
      sender_name: 'Alice',
      subject: '#general',
    })).toBe('slack:C01234ABC');
  });

  it('falls back to sender_name:normalizeSubject when channel_id is absent', () => {
    expect(slackThreadId({
      channel_id: null,
      sender_name: 'Bob',
      subject: 'DM with Bob',
    })).toBe('slack:Bob:DM with Bob');
  });

  it('uses "unknown" when sender_name is null', () => {
    expect(slackThreadId({
      sender_name: null,
      subject: '#random',
    })).toBe('slack:unknown:#random');
  });

  it('normalizes subject in fallback path', () => {
    expect(slackThreadId({
      sender_name: 'Carol',
      subject: 'Re: standup notes',
    })).toBe('slack:Carol:standup notes');
  });

  it('handles all nulls gracefully', () => {
    expect(slackThreadId({})).toBe('slack:unknown:');
  });
});
