/**
 * Feed store tests.
 *
 * Mocks `window.whimAPI` so we can exercise loadInitial / prepend /
 * action methods without spinning up Electron.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { feedStore } from './feed-store';
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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
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
    // notified at least twice: loading=true, then loaded with data.
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
    // Order: c, b, a
    feedStore.updateInPlace(makeNotif('b', { subject: 'B updated', urgency: 'urgent' } as any));
    const list = feedStore.getState().notifications;
    expect(list.map(n => n.source_uid)).toEqual(['c', 'b', 'a']);
    expect(list[1].subject).toBe('B updated');
    expect((list[1] as any).urgency).toBe('urgent');
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
