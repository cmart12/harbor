import { describe, it, expect } from 'vitest';
import {
  buildPrompt,
  preClassifyHeuristics,
  parseClassifierResponse,
  CLASSIFIER_SYSTEM_MESSAGE,
  type PromptNotificationInput,
} from './prompt';
import type { Notification } from '../../shared/notification-types';
import type { Goal, Category } from '../../shared/goal-category-types';

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    source_uid: 'uid-1',
    source: 'macos',
    app_id: 'com.example.app',
    sender_name: 'Alice',
    sender_email: 'alice@example.com',
    subject: 'Quick question',
    body: 'Hey, do you have a minute to look at the spec? I want to ship today.',
    received_at: '2026-06-15T10:00:00Z',
    deep_link: null,
    status: 'unread',
    snoozed_until: null,
    promoted_space_id: null,
    category_id: null,
    goal_id: null,
    urgency: 'whenever',
    classification_status: 'pending',
    classification_attempts: 0,
    classified_at: null,
    classification_reasoning: null,
    created_at: '2026-06-15T10:00:00Z',
    updated_at: '2026-06-15T10:00:00Z',
    ...overrides,
  };
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g-ship',
    title: 'Ship Harbor B.2',
    description: 'Get the classifier into chris\'s hands',
    color: '#1f9eff',
    sort_order: 0,
    archived_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'c-eng',
    title: 'Engineering',
    description: null,
    color: '#888888',
    sort_order: 0,
    archived_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('preClassifyHeuristics', () => {
  it('flags no-reply senders as whenever', () => {
    const n = makeNotification({ sender_email: 'noreply@example.com' });
    expect(preClassifyHeuristics(n)?.urgency).toBe('whenever');
  });

  it('flags hyphenated no-reply senders as whenever', () => {
    const n = makeNotification({ sender_email: 'no-reply@example.com', sender_name: null });
    expect(preClassifyHeuristics(n)?.urgency).toBe('whenever');
  });

  it('flags very short body with no question as whenever', () => {
    const n = makeNotification({ body: 'ok', subject: 'fyi' });
    expect(preClassifyHeuristics(n)?.urgency).toBe('whenever');
  });

  it('does not flag a short body if subject contains a question', () => {
    const n = makeNotification({ body: 'ok', subject: 'is this still on?' });
    expect(preClassifyHeuristics(n)).toBeNull();
  });

  it('does not flag a normal notification', () => {
    const n = makeNotification();
    expect(preClassifyHeuristics(n)).toBeNull();
  });
});

describe('buildPrompt', () => {
  it('lists categories by id with description', () => {
    const inputs: PromptNotificationInput[] = [{ notification: makeNotification() }];
    const prompt = buildPrompt(inputs, [], [makeCategory({ description: 'tech work' })], new Set());
    expect(prompt).toContain('c-eng');
    expect(prompt).toContain('Engineering');
    expect(prompt).toContain('tech work');
  });

  it('lists goals with associated description', () => {
    const inputs: PromptNotificationInput[] = [{ notification: makeNotification() }];
    const prompt = buildPrompt(inputs, [makeGoal()], [], new Set());
    expect(prompt).toContain('g-ship');
    expect(prompt).toContain('Ship Harbor B.2');
  });

  it('says "(none configured)" when categories list is empty', () => {
    const inputs: PromptNotificationInput[] = [{ notification: makeNotification() }];
    const prompt = buildPrompt(inputs, [], [], new Set());
    expect(prompt).toContain('none configured');
  });

  it('embeds the heuristic hint when present', () => {
    const inputs: PromptNotificationInput[] = [
      { notification: makeNotification(), hint: { urgency: 'whenever', reason: 'auto-digest' } },
    ];
    const prompt = buildPrompt(inputs, [], [], new Set());
    expect(prompt).toContain('hint: urgency=whenever');
    expect(prompt).toContain('auto-digest');
  });

  it('omits hint line when none provided', () => {
    const inputs: PromptNotificationInput[] = [{ notification: makeNotification() }];
    const prompt = buildPrompt(inputs, [], [], new Set());
    expect(prompt).not.toContain('hint:');
  });

  it('includes a VIP marker when the sender email matches', () => {
    const inputs: PromptNotificationInput[] = [{ notification: makeNotification({ sender_email: 'vip@example.com' }) }];
    const prompt = buildPrompt(inputs, [], [], new Set(['vip@example.com']));
    expect(prompt).toContain('vip: true');
  });

  it('truncates long bodies', () => {
    const longBody = 'x'.repeat(2000);
    const inputs: PromptNotificationInput[] = [
      { notification: makeNotification({ body: longBody }) },
    ];
    const prompt = buildPrompt(inputs, [], [], new Set());
    expect(prompt).toContain('...');
    expect(prompt.length).toBeLessThan(2000);
  });

  it('numbers each notification block', () => {
    const inputs: PromptNotificationInput[] = [
      { notification: makeNotification({ source_uid: 'a' }) },
      { notification: makeNotification({ source_uid: 'b' }) },
    ];
    const prompt = buildPrompt(inputs, [], [], new Set());
    expect(prompt).toContain('--- notification 1 ---');
    expect(prompt).toContain('--- notification 2 ---');
  });

  it('uses fallback subject and sender labels for empty fields', () => {
    const inputs: PromptNotificationInput[] = [
      {
        notification: makeNotification({
          subject: null,
          sender_name: null,
          sender_email: null,
          app_id: 'com.example.app',
        }),
      },
    ];
    const prompt = buildPrompt(inputs, [], [], new Set());
    expect(prompt).toContain('(no subject)');
    expect(prompt).toContain('com.example.app');
  });
});

describe('CLASSIFIER_SYSTEM_MESSAGE', () => {
  it('describes the JSON array response contract', () => {
    expect(CLASSIFIER_SYSTEM_MESSAGE).toContain('JSON array');
    expect(CLASSIFIER_SYSTEM_MESSAGE).toContain('urgent');
    expect(CLASSIFIER_SYSTEM_MESSAGE).toContain('whenever');
  });
});

describe('parseClassifierResponse', () => {
  const goals = new Set(['g-ship', 'g-other']);
  const cats = new Set(['c-eng', 'c-pm']);

  it('parses a clean array response', () => {
    const content = JSON.stringify([
      { uid: 'a', category_id: 'c-eng', goal_id: 'g-ship', urgency: 'urgent', reasoning: 'because' },
    ]);
    const parsed = parseClassifierResponse(content, goals, cats);
    expect(parsed).toEqual([{
      uid: 'a', category_id: 'c-eng', goal_id: 'g-ship', urgency: 'urgent', reasoning: 'because',
    }]);
  });

  it('extracts the array even when wrapped in prose', () => {
    const content = 'Here you go: ' + JSON.stringify([
      { uid: 'a', category_id: null, goal_id: null, urgency: 'today', reasoning: 'ok' },
    ]) + ' done.';
    const parsed = parseClassifierResponse(content, goals, cats);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].urgency).toBe('today');
  });

  it('returns [] for invalid JSON', () => {
    expect(parseClassifierResponse('not json', goals, cats)).toEqual([]);
    expect(parseClassifierResponse('[broken', goals, cats)).toEqual([]);
  });

  it('drops entries with unknown urgency', () => {
    const content = JSON.stringify([
      { uid: 'a', category_id: null, goal_id: null, urgency: 'yesterday', reasoning: '' },
    ]);
    expect(parseClassifierResponse(content, goals, cats)).toEqual([]);
  });

  it('normalizes urgency synonyms', () => {
    const content = JSON.stringify([
      { uid: 'a', urgency: 'now' },
      { uid: 'b', urgency: 'fyi' },
      { uid: 'c', urgency: 'this_week' },
    ]);
    const parsed = parseClassifierResponse(content, goals, cats);
    expect(parsed.map(p => p.urgency)).toEqual(['urgent', 'whenever', 'this-week']);
  });

  it('strips unknown goal_id and category_id (sets to null)', () => {
    const content = JSON.stringify([
      { uid: 'a', category_id: 'c-bogus', goal_id: 'g-bogus', urgency: 'urgent' },
    ]);
    const parsed = parseClassifierResponse(content, goals, cats);
    expect(parsed[0].category_id).toBeNull();
    expect(parsed[0].goal_id).toBeNull();
  });

  it('keeps reasoning when present, returns null when empty', () => {
    const content = JSON.stringify([
      { uid: 'a', urgency: 'urgent', reasoning: '   ' },
      { uid: 'b', urgency: 'today', reasoning: 'real reason' },
    ]);
    const parsed = parseClassifierResponse(content, goals, cats);
    expect(parsed[0].reasoning).toBeNull();
    expect(parsed[1].reasoning).toBe('real reason');
  });

  it('drops entries missing a uid', () => {
    const content = JSON.stringify([
      { urgency: 'urgent' },
      { uid: 'b', urgency: 'today' },
    ]);
    const parsed = parseClassifierResponse(content, goals, cats);
    expect(parsed.map(p => p.uid)).toEqual(['b']);
  });

  it('returns [] when the array is empty', () => {
    expect(parseClassifierResponse('[]', goals, cats)).toEqual([]);
  });

  it('returns [] when the top-level is an object, not an array', () => {
    const content = JSON.stringify({ uid: 'a', urgency: 'urgent' });
    expect(parseClassifierResponse(content, goals, cats)).toEqual([]);
  });
});
