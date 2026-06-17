/**
 * Feed store (Phase B.3) — renderer-side cache for the Notifications Feed.
 *
 * Mirrors the subscribe/notify shape of `space-store.ts`. The Feed tab
 * subscribes once on activation and re-renders on every change. Action
 * methods optimistically mutate the cache and call the corresponding
 * IPC; on IPC failure we re-fetch to resync.
 */

import type { Goal, Category } from '../../shared/goal-category-types';
import type {
  Notification,
  NotificationStatus,
  SnoozePreset,
  Urgency,
} from '../../shared/notification-types';
import { getAPI } from '../ipc-client';

type Listener = () => void;

export type FeedViewMode = 'by-time' | 'by-urgency' | 'by-category' | 'by-goal' | 'by-thread';

export interface FeedFilters {
  urgency: Set<Urgency>;
  categoryIds: Set<string>;
  goalIds: Set<string>;
  sources: Set<string>;
}

export interface FeedGroup {
  groupId: string;
  groupTitle: string;
  groupColor: string;
  groupDescription?: string;
  items: Notification[];
}

/** Phase C.0: a collapsed thread in the "By Thread" view. */
export interface ThreadGroup {
  threadId: string;
  items: Notification[];
  latestAt: string;
  urgency: Urgency;
  vip: boolean;
  category: string | null;
  summarySubject: string;
  summarySender: string;
}

export interface FeedState {
  notifications: Notification[];
  loaded: boolean;
  loading: boolean;
  viewMode: FeedViewMode;
  filters: FeedFilters;
}

type FeedFilterKey = keyof FeedFilters;

type StoredFeedFilters = Record<FeedFilterKey, string[]>;

const FEED_VIEW_MODE_KEY = 'harbor:feed-view-mode';
const FEED_FILTERS_KEY = 'harbor:feed-filters';
const DEFAULT_VIEW_MODE: FeedViewMode = 'by-time';
const URGENCY_GROUP_META: Array<{ id: Urgency; title: string; color: string }> = [
  { id: 'urgent', title: 'Urgent', color: '#e5484d' },
  { id: 'today', title: 'Today', color: '#f5a623' },
  { id: 'this-week', title: 'This week', color: '#d4a017' },
  { id: 'whenever', title: 'Whenever', color: '#888888' },
];

function createEmptyFilters(): FeedFilters {
  return {
    urgency: new Set<Urgency>(),
    categoryIds: new Set<string>(),
    goalIds: new Set<string>(),
    sources: new Set<string>(),
  };
}

function cloneFilters(filters: FeedFilters): FeedFilters {
  return {
    urgency: new Set(filters.urgency),
    categoryIds: new Set(filters.categoryIds),
    goalIds: new Set(filters.goalIds),
    sources: new Set(filters.sources),
  };
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function loadViewMode(): FeedViewMode {
  const storage = getStorage();
  if (!storage) return DEFAULT_VIEW_MODE;
  try {
    const raw = storage.getItem(FEED_VIEW_MODE_KEY);
    return raw === 'by-urgency' || raw === 'by-category' || raw === 'by-goal' || raw === 'by-time' || raw === 'by-thread'
      ? raw
      : DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

function loadFilters(): FeedFilters {
  const storage = getStorage();
  if (!storage) return createEmptyFilters();
  try {
    const raw = storage.getItem(FEED_FILTERS_KEY);
    if (!raw) return createEmptyFilters();
    const parsed = JSON.parse(raw) as Partial<StoredFeedFilters>;
    return {
      urgency: new Set((parsed.urgency ?? []) as Urgency[]),
      categoryIds: new Set(parsed.categoryIds ?? []),
      goalIds: new Set(parsed.goalIds ?? []),
      sources: new Set(parsed.sources ?? []),
    };
  } catch {
    return createEmptyFilters();
  }
}

function persistViewMode(mode: FeedViewMode): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(FEED_VIEW_MODE_KEY, mode);
  } catch {
    // ignore storage failures
  }
}

function persistFilters(filters: FeedFilters): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const payload: StoredFeedFilters = {
      urgency: Array.from(filters.urgency),
      categoryIds: Array.from(filters.categoryIds),
      goalIds: Array.from(filters.goalIds),
      sources: Array.from(filters.sources),
    };
    storage.setItem(FEED_FILTERS_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
}

function matchesFilter(set: Set<string>, value: string | null | undefined): boolean {
  if (set.size === 0) return true;
  if (!value) return false;
  return set.has(value);
}

class FeedStore {
  private state: FeedState;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.state = this.createInitialState();
  }

  private createInitialState(): FeedState {
    return {
      notifications: [],
      loaded: false,
      loading: false,
      viewMode: loadViewMode(),
      filters: loadFilters(),
    };
  }

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

  private persistPreferences(): void {
    persistViewMode(this.state.viewMode);
    persistFilters(this.state.filters);
  }

  /** Fetch the default Feed view (active, non-snoozed). Idempotent. */
  async loadInitial(): Promise<void> {
    if (this.state.loading) return;
    this.state = { ...this.state, loading: true };
    this.notify();
    try {
      const api = getAPI();
      const list = (await api.listNotifications()) as Notification[];
      this.state = {
        ...this.state,
        notifications: list,
        loaded: true,
        loading: false,
      };
    } catch (err) {
      console.warn('[feed-store] loadInitial failed:', err);
      this.state = { ...this.state, loading: false };
    }
    this.notify();
  }

  setViewMode(mode: FeedViewMode): void {
    if (this.state.viewMode === mode) return;
    this.state = { ...this.state, viewMode: mode };
    this.persistPreferences();
    this.notify();
  }

  toggleFilter(type: FeedFilterKey, value: string): void {
    const filters = cloneFilters(this.state.filters);
    const next = filters[type] as Set<string>;
    if (next.has(value)) next.delete(value);
    else next.add(value);
    this.state = { ...this.state, filters };
    this.persistPreferences();
    this.notify();
  }

  clearFilters(): void {
    this.state = { ...this.state, filters: createEmptyFilters() };
    this.persistPreferences();
    this.notify();
  }

  removeFilter(type: FeedFilterKey, value: string): void {
    const filters = cloneFilters(this.state.filters);
    (filters[type] as Set<string>).delete(value);
    this.state = { ...this.state, filters };
    this.persistPreferences();
    this.notify();
  }

  getFiltered(): Notification[] {
    const { notifications, filters } = this.state;
    return notifications.filter(notification => {
      if (!matchesFilter(filters.urgency as Set<string>, notification.urgency)) return false;
      if (!matchesFilter(filters.categoryIds, notification.category_id)) return false;
      if (!matchesFilter(filters.goalIds, notification.goal_id)) return false;
      if (!matchesFilter(filters.sources, notification.source)) return false;
      return true;
    });
  }

  getGroupedByUrgency(goals: Goal[], categories: Category[]): FeedGroup[] {
    void goals;
    void categories;
    const buckets = new Map<Urgency, Notification[]>();
    for (const meta of URGENCY_GROUP_META) buckets.set(meta.id, []);
    for (const notification of this.getFiltered()) {
      buckets.get(notification.urgency)?.push(notification);
    }
    return URGENCY_GROUP_META.map(meta => ({
      groupId: `urgency:${meta.id}`,
      groupTitle: meta.title,
      groupColor: meta.color,
      items: buckets.get(meta.id) ?? [],
    }));
  }

  getGroupedByCategory(categories: Category[]): FeedGroup[] {
    const buckets = new Map<string, Notification[]>();
    for (const category of categories) buckets.set(category.id, []);
    const uncategorized: Notification[] = [];
    for (const notification of this.getFiltered()) {
      if (notification.category_id && buckets.has(notification.category_id)) {
        buckets.get(notification.category_id)?.push(notification);
      } else {
        uncategorized.push(notification);
      }
    }
    return [
      ...categories.map(category => ({
        groupId: `category:${category.id}`,
        groupTitle: category.title,
        groupColor: category.color,
        groupDescription: category.description ?? undefined,
        items: buckets.get(category.id) ?? [],
      })),
      {
        groupId: 'category:uncategorized',
        groupTitle: 'Uncategorized',
        groupColor: '#6B7280',
        items: uncategorized,
      },
    ];
  }

  getGroupedByGoal(goals: Goal[]): FeedGroup[] {
    const buckets = new Map<string, Notification[]>();
    for (const goal of goals) buckets.set(goal.id, []);
    const unaligned: Notification[] = [];
    for (const notification of this.getFiltered()) {
      if (notification.goal_id && buckets.has(notification.goal_id)) {
        buckets.get(notification.goal_id)?.push(notification);
      } else {
        unaligned.push(notification);
      }
    }
    return [
      ...goals.map(goal => ({
        groupId: `goal:${goal.id}`,
        groupTitle: goal.title,
        groupColor: goal.color,
        groupDescription: goal.description ?? undefined,
        items: buckets.get(goal.id) ?? [],
      })),
      {
        groupId: 'goal:unaligned',
        groupTitle: 'Unaligned',
        groupColor: '#6B7280',
        items: unaligned,
      },
    ];
  }

  /**
   * Phase C.0: group filtered notifications by `thread_id`.
   * Singletons (count == 1) stay as normal rows; threads (count >= 2)
   * collapse into ThreadGroup cards.
   */
  getGroupedByThread(): { threads: ThreadGroup[]; singletons: Notification[] } {
    const filtered = this.getFiltered();
    const buckets = new Map<string, Notification[]>();
    const noThread: Notification[] = [];

    for (const n of filtered) {
      if (!n.thread_id) {
        noThread.push(n);
        continue;
      }
      const list = buckets.get(n.thread_id);
      if (list) {
        list.push(n);
      } else {
        buckets.set(n.thread_id, [n]);
      }
    }

    const threads: ThreadGroup[] = [];
    const singletons: Notification[] = [...noThread];

    for (const [threadId, items] of buckets) {
      if (items.length < 2) {
        singletons.push(...items);
        continue;
      }
      // Sort items chronologically (oldest first) within the thread
      items.sort((a, b) => a.received_at.localeCompare(b.received_at));

      const latest = items[items.length - 1];
      const highestUrgency = pickHighestUrgency(items);
      const hasVip = items.some(n => n.is_vip);
      const mostCommonCategory = pickMostCommonCategory(items);

      threads.push({
        threadId,
        items,
        latestAt: latest.received_at,
        urgency: highestUrgency,
        vip: hasVip,
        category: mostCommonCategory,
        summarySubject: latest.subject ?? threadId,
        summarySender: latest.sender_name ?? latest.sender_email ?? 'Unknown',
      });
    }

    // Sort threads by latest message DESC
    threads.sort((a, b) => b.latestAt.localeCompare(a.latestAt));
    // Sort singletons by received_at DESC
    singletons.sort((a, b) => b.received_at.localeCompare(a.received_at));

    return { threads, singletons };
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

  /** Replace a row by `source_uid` while preserving its position in the list. */
  updateInPlace(notif: Notification): void {
    const idx = this.state.notifications.findIndex(n => n.source_uid === notif.source_uid);
    if (idx < 0) return;
    const copy = this.state.notifications.slice();
    copy[idx] = notif;
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

  // -- Phase C.0: thread bulk-action methods ---------------------------------

  async snoozeThread(threadId: string, preset: SnoozePreset): Promise<boolean> {
    const items = this.state.notifications.filter(n => n.thread_id === threadId);
    let allOk = true;
    for (const n of items) {
      const ok = await this.snooze(n.source_uid, preset);
      if (!ok) allOk = false;
    }
    return allOk;
  }

  async archiveThread(threadId: string): Promise<boolean> {
    const items = this.state.notifications.filter(n => n.thread_id === threadId);
    let allOk = true;
    for (const n of items) {
      const ok = await this.archive(n.source_uid);
      if (!ok) allOk = false;
    }
    return allOk;
  }

  async markThreadDone(threadId: string): Promise<boolean> {
    const items = this.state.notifications.filter(n => n.thread_id === threadId);
    let allOk = true;
    for (const n of items) {
      const ok = await this.markDone(n.source_uid);
      if (!ok) allOk = false;
    }
    return allOk;
  }

  async promoteThread(threadId: string): Promise<{ spaceId: string } | null> {
    // Promote the latest message, which carries full thread context
    const items = this.state.notifications.filter(n => n.thread_id === threadId);
    if (items.length === 0) return null;
    items.sort((a, b) => b.received_at.localeCompare(a.received_at));
    return this.promoteToNewSpace(items[0].source_uid);
  }

  /** Test-only reset hook. */
  _resetForTests(): void {
    this.state = this.createInitialState();
    this.listeners.clear();
  }
}

export const feedStore = new FeedStore();

// ---------------------------------------------------------------------------
// Phase C.0: thread grouping helpers
// ---------------------------------------------------------------------------

const URGENCY_RANK: Record<Urgency, number> = {
  urgent: 0,
  today: 1,
  'this-week': 2,
  whenever: 3,
};

function pickHighestUrgency(items: Notification[]): Urgency {
  let best: Urgency = 'whenever';
  for (const n of items) {
    if (URGENCY_RANK[n.urgency] < URGENCY_RANK[best]) {
      best = n.urgency;
    }
  }
  return best;
}

/**
 * Return the most common non-null category_id in the list.
 * Ties go to the category of the most recent item.
 */
function pickMostCommonCategory(items: Notification[]): string | null {
  const counts = new Map<string, number>();
  for (const n of items) {
    if (n.category_id) {
      counts.set(n.category_id, (counts.get(n.category_id) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return null;

  let maxCount = 0;
  for (const c of counts.values()) {
    if (c > maxCount) maxCount = c;
  }

  // Among ties, prefer the most recent item's category
  const tiedIds = new Set<string>();
  for (const [id, c] of counts) {
    if (c === maxCount) tiedIds.add(id);
  }
  if (tiedIds.size === 1) return tiedIds.values().next().value!;

  // Walk items in reverse chronological order (latest first)
  const sorted = [...items].sort((a, b) => b.received_at.localeCompare(a.received_at));
  for (const n of sorted) {
    if (n.category_id && tiedIds.has(n.category_id)) return n.category_id;
  }
  return tiedIds.values().next().value!;
}
