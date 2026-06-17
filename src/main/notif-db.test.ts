/**
 * Sidecar notifications DB tests.
 *
 * Uses better-sqlite3 in-memory (':memory:') to avoid touching the user's
 * real notifications.db. The module exports `_resetForTests` to clear the
 * cached singleton between tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  openNotifDb,
  closeNotifDb,
  _resetForTests,
  insertNotification,
  getNotification,
  listNotifications,
  updateStatus,
  setPromotedSpace,
} from './notif-db';

function sampleInput(uid: string, opts: Partial<{ received_at: string; subject: string; source: string }> = {}) {
  return {
    source_uid: uid,
    source: opts.source ?? 'macos',
    app_id: 'com.example.app',
    sender_name: 'Test Sender',
    sender_email: 'sender@example.com',
    subject: opts.subject ?? 'A subject',
    body: 'A body',
    received_at: opts.received_at ?? new Date().toISOString(),
    deep_link: null,
  };
}

describe('notif-db', () => {
  beforeEach(() => {
    _resetForTests();
    openNotifDb(':memory:');
  });

  afterEach(() => {
    closeNotifDb();
    _resetForTests();
  });

  it('inserts a notification and reads it back', () => {
    const ok = insertNotification(sampleInput('uid-1'));
    expect(ok).toBe(true);
    const row = getNotification('uid-1');
    expect(row).not.toBeNull();
    expect(row?.source_uid).toBe('uid-1');
    expect(row?.status).toBe('unread');
    expect(row?.sender_name).toBe('Test Sender');
  });

  it('deduplicates by source_uid (INSERT OR IGNORE)', () => {
    expect(insertNotification(sampleInput('dup'))).toBe(true);
    // Second insert with same uid is a no-op.
    expect(insertNotification(sampleInput('dup', { subject: 'different' }))).toBe(false);
    const row = getNotification('dup');
    expect(row?.subject).toBe('A subject'); // original wins
  });

  it('default list hides archived, done, promoted, and future-snoozed', () => {
    insertNotification(sampleInput('active'));
    insertNotification(sampleInput('archived'));
    updateStatus('archived', 'archived');
    insertNotification(sampleInput('done'));
    updateStatus('done', 'done');
    insertNotification(sampleInput('promoted'));
    updateStatus('promoted', 'promoted');
    insertNotification(sampleInput('snoozed-future'));
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    updateStatus('snoozed-future', 'snoozed', future);
    insertNotification(sampleInput('snoozed-past'));
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    updateStatus('snoozed-past', 'snoozed', past);

    const active = listNotifications();
    const uids = active.map(n => n.source_uid).sort();
    // 'active' and 'snoozed-past' are visible; archived/done/promoted/snoozed-future hidden.
    expect(uids).toEqual(['active', 'snoozed-past']);
  });

  it('status-specific list returns matching rows regardless of snooze', () => {
    insertNotification(sampleInput('a'));
    updateStatus('a', 'archived');
    insertNotification(sampleInput('b'));
    updateStatus('b', 'archived');
    insertNotification(sampleInput('c'));
    const archived = listNotifications({ status: 'archived' });
    expect(archived.map(n => n.source_uid).sort()).toEqual(['a', 'b']);
  });

  it('list orders newest first by received_at', () => {
    insertNotification(sampleInput('old', { received_at: '2026-01-01T00:00:00Z' }));
    insertNotification(sampleInput('new', { received_at: '2026-06-15T00:00:00Z' }));
    insertNotification(sampleInput('mid', { received_at: '2026-04-01T00:00:00Z' }));
    const list = listNotifications();
    expect(list.map(n => n.source_uid)).toEqual(['new', 'mid', 'old']);
  });

  it('updateStatus persists snoozed_until', () => {
    insertNotification(sampleInput('s'));
    const until = '2030-01-01T09:00:00Z';
    expect(updateStatus('s', 'snoozed', until)).toBe(true);
    const row = getNotification('s');
    expect(row?.status).toBe('snoozed');
    expect(row?.snoozed_until).toBe(until);
  });

  it('setPromotedSpace stores the space id', () => {
    insertNotification(sampleInput('p'));
    expect(setPromotedSpace('p', 'space-abc')).toBe(true);
    const row = getNotification('p');
    expect(row?.status).toBe('promoted');
    expect(row?.promoted_space_id).toBe('space-abc');
  });

  it('inserts and reads back thread_id', () => {
    const ok = insertNotification({ ...sampleInput('tid-1'), thread_id: 'macos:com.slack' });
    expect(ok).toBe(true);
    const row = getNotification('tid-1');
    expect(row).not.toBeNull();
    expect(row?.thread_id).toBe('macos:com.slack');
  });

  it('thread_id defaults to null when not provided', () => {
    insertNotification(sampleInput('tid-2'));
    const row = getNotification('tid-2');
    expect(row?.thread_id).toBeNull();
  });

  it('listNotifications includes thread_id in results', () => {
    insertNotification({ ...sampleInput('tid-3'), thread_id: 'workiq-outlook:conv-1' });
    insertNotification({ ...sampleInput('tid-4'), thread_id: null });
    const rows = listNotifications();
    const t3 = rows.find(r => r.source_uid === 'tid-3');
    const t4 = rows.find(r => r.source_uid === 'tid-4');
    expect(t3?.thread_id).toBe('workiq-outlook:conv-1');
    expect(t4?.thread_id).toBeNull();
  });
});
