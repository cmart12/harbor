/**
 * Feed store tests.
 *
 * Mocks `window.whimAPI` so we can exercise loadInitial / prepend /
 * action methods without spinning up Electron.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { feedStore } from './feed-store';
import type { Goal, Category } from '../../shared/goal-category-types';
import type { Notification } from '../../shared/notification-types';

function makeNotif(uid: string, overrides: Partial<Notification> = {}): Notification {
  return {
    source_uid: uid,
    source: 'macos',
    app_id: 'com.example',
    sender_name: 'Sender',
    sender_email: 'sender@example.com',
    subject: `Subject ${uid}`,
    body: 'Body',
    received_at: new Date().toISOString(),
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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeGoal(id: string, title = id): Goal {
  return {
    id,
    title,
    description: null,
    color: '#2563eb',
    sort_order: 0,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeCategory(id: string, title = id): Category {
  return {
    id,
    title,
    description: null,
    color: '#10b981',
    sort_order: 0,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key: string) => store.has(key) ? store.get(key)! : null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => { store.delete(key); },
    setItem: (key: string, value: string) => { store.set(key, value); },
  } as Storage;
}

const api = {
  listNotifications: vi.fn(),
  snoozeNotification: vi.fn(),
  archiveNotification: vi.fn(),
  markNotificationDone: vi.fn(),
  promoteNotificationToNewSpace: vi.fn(),
  openNotificationLink: vi.fn(),
};

beforeEach(() => {
  (globalThis as any).localStorage = createStorageMock();
  feedStore._resetForTests();
  for (const fn of Object.values(api)) fn.mockReset();
  (globalThis as any).window = { whimAPI: api };
});

describe('feedStore', () => {
  it('loadInitial populates the cache and notifies subscribers', async () => {
    api.listNotifications.mockResolvedValue([makeNotif('a'), makeNotif('b')]);
    const seen: number[] = [];
    feedStore.subscribe(() => seen.push(feedStore.getState().notifications.length));
    await feedStore.loadInitial();
    expect(feedStore.getState().notifications.map(n => n.source_uid)).toEqual(['a', 'b']);
    expect(feedStore.getState().loaded).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it('prepend dedupes by source_uid', () => {
    feedStore.prepend(makeNotif('x', { subject: 'first' }));
    feedStore.prepend(makeNotif('x', { subject: 'second' }));
    const list = feedStore.getState().notifications;
    expect(list.length).toBe(1);
    expect(list[0].subject).toBe('first');
  });

  it('prepend places newer items at the top', () => {
    feedStore.prepend(makeNotif('a'));
    feedStore.prepend(makeNotif('b'));
    expect(feedStore.getState().notifications.map(n => n.source_uid)).toEqual(['b', 'a']);
  });

  it('applies OR within a filter type and AND across types', () => {
    feedStore.prepend(makeNotif('a', { urgency: 'urgent', category_id: 'cat-1', source: 'slack' }));
    feedStore.prepend(makeNotif('b', { urgency: 'today', category_id: 'cat-1', source: 'email' }));
    feedStore.prepend(makeNotif('c', { urgency: 'urgent', category_id: 'cat-2', source: 'email' }));
    feedStore.prepend(makeNotif('d', { urgency: 'whenever', category_id: 'cat-2', source: 'email' }));

    feedStore.toggleFilter('urgency', 'urgent');
    feedStore.toggleFilter('urgency', 'today');
    feedStore.toggleFilter('categoryIds', 'cat-1');
    feedStore.toggleFilter('sources', 'email');

    expect(feedStore.getFiltered().map(n => n.source_uid)).toEqual(['b']);
  });

  it('groups by urgency while preserving current order within each bucket', () => {
    feedStore.prepend(makeNotif('a', { urgency: 'urgent' }));
    feedStore.prepend(makeNotif('b', { urgency: 'today' }));
    feedStore.prepend(makeNotif('c', { urgency: 'urgent' }));

    const groups = feedStore.getGroupedByUrgency([], []);
    expect(groups.find(group => group.groupId === 'urgency:urgent')?.items.map(n => n.source_uid)).toEqual(['c', 'a']);
    expect(groups.find(group => group.groupId === 'urgency:today')?.items.map(n => n.source_uid)).toEqual(['b']);
  });

  it('groups by category and goal while preserving current order within each bucket', () => {
    feedStore.prepend(makeNotif('a', { category_id: 'cat-1', goal_id: 'goal-1' }));
    feedStore.prepend(makeNotif('b', { category_id: 'cat-2', goal_id: 'goal-2' }));
    feedStore.prepend(makeNotif('c', { category_id: 'cat-1', goal_id: 'goal-1' }));
    feedStore.prepend(makeNotif('d', { category_id: null, goal_id: null }));

    const categories = [makeCategory('cat-1', 'Cat 1'), makeCategory('cat-2', 'Cat 2')];
    const goals = [makeGoal('goal-1', 'Goal 1'), makeGoal('goal-2', 'Goal 2')];

    const categoryGroups = feedStore.getGroupedByCategory(categories);
    expect(categoryGroups.find(group => group.groupId === 'category:cat-1')?.items.map(n => n.source_uid)).toEqual(['c', 'a']);
    expect(categoryGroups.find(group => group.groupId === 'category:uncategorized')?.items.map(n => n.source_uid)).toEqual(['d']);

    const goalGroups = feedStore.getGroupedByGoal(goals);
    expect(goalGroups.find(group => group.groupId === 'goal:goal-1')?.items.map(n => n.source_uid)).toEqual(['c', 'a']);
    expect(goalGroups.find(group => group.groupId === 'goal:unaligned')?.items.map(n => n.source_uid)).toEqual(['d']);
  });

  it('persists view mode and filters through a reset', () => {
    feedStore.setViewMode('by-category');
    feedStore.toggleFilter('categoryIds', 'cat-1');
    feedStore.toggleFilter('sources', 'email');

    feedStore._resetForTests();

    expect(feedStore.getState().viewMode).toBe('by-category');
    expect(Array.from(feedStore.getState().filters.categoryIds)).toEqual(['cat-1']);
    expect(Array.from(feedStore.getState().filters.sources)).toEqual(['email']);
  });

  it('snooze removes the row on success', async () => {
    feedStore.prepend(makeNotif('s'));
    api.snoozeNotification.mockResolvedValue({ ok: true, snoozedUntil: '2030-01-01T00:00:00Z' });
    const ok = await feedStore.snooze('s', '1h');
    expect(ok).toBe(true);
    expect(api.snoozeNotification).toHaveBeenCalledWith('s', '1h');
    expect(feedStore.getState().notifications).toHaveLength(0);
  });

  it('snooze keeps the row on failure', async () => {
    feedStore.prepend(makeNotif('s'));
    api.snoozeNotification.mockResolvedValue({ error: 'boom' });
    const ok = await feedStore.snooze('s', '1h');
    expect(ok).toBe(false);
    expect(feedStore.getState().notifications).toHaveLength(1);
  });

  it('archive removes the row on success', async () => {
    feedStore.prepend(makeNotif('a'));
    api.archiveNotification.mockResolvedValue({ ok: true });
    await feedStore.archive('a');
    expect(feedStore.getState().notifications).toHaveLength(0);
  });

  it('markDone removes the row on success', async () => {
    feedStore.prepend(makeNotif('d'));
    api.markNotificationDone.mockResolvedValue({ ok: true });
    await feedStore.markDone('d');
    expect(feedStore.getState().notifications).toHaveLength(0);
  });

  it('promoteToNewSpace returns spaceId and removes the row', async () => {
    feedStore.prepend(makeNotif('p'));
    api.promoteNotificationToNewSpace.mockResolvedValue({ spaceId: 'space-1' });
    const res = await feedStore.promoteToNewSpace('p');
    expect(res).toEqual({ spaceId: 'space-1' });
    expect(feedStore.getState().notifications).toHaveLength(0);
  });

  it('updateStatus mutates an in-cache row without removing it', () => {
    feedStore.prepend(makeNotif('u'));
    feedStore.updateStatus('u', 'read');
    expect(feedStore.getState().notifications[0].status).toBe('read');
  });

  it('updateInPlace replaces a row by source_uid while preserving order', () => {
    feedStore.prepend(makeNotif('a', { subject: 'A original' }));
    feedStore.prepend(makeNotif('b', { subject: 'B original' }));
    feedStore.prepend(makeNotif('c', { subject: 'C original' }));
    feedStore.updateInPlace(makeNotif('b', { subject: 'B updated', urgency: 'urgent' }));
    const list = feedStore.getState().notifications;
    expect(list.map(n => n.source_uid)).toEqual(['c', 'b', 'a']);
    expect(list[1].subject).toBe('B updated');
    expect(list[1].urgency).toBe('urgent');
  });

  it('updateInPlace is a no-op when the row is not in the cache', () => {
    feedStore.prepend(makeNotif('a'));
    const notified = vi.fn();
    feedStore.subscribe(notified);
    feedStore.updateInPlace(makeNotif('not-present'));
    expect(notified).not.toHaveBeenCalled();
    expect(feedStore.getState().notifications).toHaveLength(1);
  });
});
