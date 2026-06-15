/**
 * Feed store (Phase A.2) — renderer-side cache for the Notifications Feed.
 *
 * Mirrors the subscribe/notify shape of `space-store.ts`. The Feed tab
 * subscribes once on activation and re-renders on every change. Action
 * methods optimistically mutate the cache and call the corresponding
 * IPC; on IPC failure we re-fetch to resync.
 *
 * Dedup rule: `source_uid` is the unique key. `prepend` is idempotent
 * — pushing the same notification twice (e.g. duplicate push events
 * during a worker restart) is a no-op past the first call.
 */

import type { Notification, NotificationStatus, SnoozePreset } from '../../shared/notification-types';
import { getAPI } from '../ipc-client';

type Listener = () => void;

export interface FeedState {
  notifications: Notification[];
  loaded: boolean;
  loading: boolean;
}

class FeedStore {
  private state: FeedState = {
    notifications: [],
    loaded: false,
    loading: false,
  };
  private listeners: Set<Listener> = new Set();

  getState(): Readonly<FeedState> {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** Fetch the default Feed view (active, non-snoozed). Idempotent. */
  async loadInitial(): Promise<void> {
    if (this.state.loading) return;
    this.state = { ...this.state, loading: true };
    this.notify();
    try {
      const api = getAPI();
      const list = (await api.listNotifications()) as Notification[];
      this.state = { notifications: list, loaded: true, loading: false };
    } catch (err) {
      console.warn('[feed-store] loadInitial failed:', err);
      this.state = { ...this.state, loading: false };
    }
    this.notify();
  }

  /** Insert a new notification at the top, deduped by source_uid. */
  prepend(notif: Notification): void {
    if (this.state.notifications.some(n => n.source_uid === notif.source_uid)) {
      return;
    }
    this.state = {
      ...this.state,
      notifications: [notif, ...this.state.notifications],
    };
    this.notify();
  }

  /** Drop a row from the local cache. Used after archive/done/promote/snooze. */
  remove(uid: string): void {
    const before = this.state.notifications.length;
    const next = this.state.notifications.filter(n => n.source_uid !== uid);
    if (next.length === before) return;
    this.state = { ...this.state, notifications: next };
    this.notify();
  }

  /** Update an in-place row (e.g. status change without removing from view). */
  updateStatus(uid: string, status: NotificationStatus, snoozedUntil?: string): void {
    const idx = this.state.notifications.findIndex(n => n.source_uid === uid);
    if (idx < 0) return;
    const copy = this.state.notifications.slice();
    copy[idx] = {
      ...copy[idx],
      status,
      snoozed_until: snoozedUntil ?? copy[idx].snoozed_until,
    };
    this.state = { ...this.state, notifications: copy };
    this.notify();
  }

  async snooze(uid: string, preset: SnoozePreset): Promise<boolean> {
    const api = getAPI();
    const res = await api.snoozeNotification(uid, preset);
    if (res && 'ok' in res) {
      this.remove(uid);
      return true;
    }
    return false;
  }

  async archive(uid: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.archiveNotification(uid);
    if (res && 'ok' in res) {
      this.remove(uid);
      return true;
    }
    return false;
  }

  async markDone(uid: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.markNotificationDone(uid);
    if (res && 'ok' in res) {
      this.remove(uid);
      return true;
    }
    return false;
  }

  async promoteToNewSpace(uid: string): Promise<{ spaceId: string } | null> {
    const api = getAPI();
    const res = await api.promoteNotificationToNewSpace(uid);
    if (res && 'spaceId' in res) {
      this.remove(uid);
      return { spaceId: res.spaceId };
    }
    return null;
  }

  async openLink(uid: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.openNotificationLink(uid);
    return !!(res && 'ok' in res);
  }

  /** Test-only reset hook. */
  _resetForTests(): void {
    this.state = { notifications: [], loaded: false, loading: false };
    this.listeners.clear();
  }
}

export const feedStore = new FeedStore();
