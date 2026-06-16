/**
 * Notification domain types (Phase A.2).
 *
 * These live in `shared/` because both the renderer and the main process need
 * them: the renderer renders feed rows and dispatches actions, the main
 * process owns the sidecar DB and IPC handlers.
 *
 * Storage decision: notifications are kept in a **sidecar SQLite database**
 * (`notifications.db` next to `whim.db`), NOT in the event-log-backed primary
 * DB. Reasons:
 *  - Volume and churn: macOS Notification Center fires many notifications per
 *    day, almost none of which the user acts on. Replaying every row through
 *    the event log on cold start would be wasted work.
 *  - Source of truth lives elsewhere: the canonical notification record lives
 *    in `~/Library/Group Containers/group.com.apple.usernoted/db2/db` (and in
 *    Slack/WorkIQ for Phase C). We re-derive on demand; we don't own it.
 *  - Promotions DO flow through the event log via `space:create` carrying a
 *    `source_notification_id`, so the link between a notification and the
 *    Space it spawned IS durable in the event log.
 */

/**
 * Allowed `status` values. Code-level enum only — there is no CHECK
 * constraint in the sidecar DB so widening the enum stays a one-line code
 * change (matches Funnel's approach in `notif_actions.rs`).
 *
 * `done` vs `archived` distinction is intentional and ported from Funnel:
 *  - `done`: I responded to / handled this notification.
 *  - `archived`: This was irrelevant; I'm dismissing it.
 *
 * The split matters for future analytics ("what fraction of notifications
 * actually need me?") and lets the Feed render different empty states.
 */
export type NotificationStatus =
  | 'unread'
  | 'read'
  | 'snoozed'
  | 'archived'
  | 'done'
  | 'promoted';

/**
 * Snooze quick-pick presets. The renderer sends the preset key; the backend
 * computes the absolute UTC RFC3339 `snoozed_until` so we don't trust the
 * frontend clock (ported verbatim from Funnel's `notif_actions.rs`).
 */
export type SnoozePreset =
  | '1h'
  | '3h'
  | 'tomorrow_9am'
  | 'next_monday_9am';

export const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  '1h',
  '3h',
  'tomorrow_9am',
  'next_monday_9am',
];

/**
 * Urgency classification (Phase B.2). Matches Funnel's four-tier model but
 * uses kebab-case identifiers that map cleanly to CSS classes and JSON.
 * Default `whenever` until the classifier (or a heuristic) overrides it.
 */
export type Urgency = 'urgent' | 'today' | 'this-week' | 'whenever';

export const URGENCY_VALUES: readonly Urgency[] = [
  'urgent',
  'today',
  'this-week',
  'whenever',
];

/**
 * Classification lifecycle. `pending` rows are awaiting an LLM round-trip,
 * `done` rows have been tagged successfully, `failed` rows exhausted retry
 * attempts. Feed renders without an urgency badge when status != `done`.
 */
export type ClassificationStatus = 'pending' | 'done' | 'failed';

export const CLASSIFICATION_STATUS_VALUES: readonly ClassificationStatus[] = [
  'pending',
  'done',
  'failed',
];

/**
 * Notification row as returned from the sidecar DB and as understood by the
 * renderer. Columns match the `notifications` table schema in `notif-db.ts`.
 *
 * All timestamps are UTC RFC3339 strings.
 */
export interface Notification {
  /** Stable per-source UID. For macOS this is the UUID hex of `record.uuid`. */
  source_uid: string;
  /** Source name: 'macos' for Phase A.2. Future: 'workiq', 'slack'. */
  source: string;
  /** Bundle id / app identifier when available (macOS app.identifier). */
  app_id: string | null;
  sender_name: string | null;
  sender_email: string | null;
  subject: string | null;
  body: string | null;
  /** Delivery time at the source, UTC RFC3339. */
  received_at: string;
  deep_link: string | null;
  status: NotificationStatus;
  /** UTC RFC3339; set only when status === 'snoozed'. */
  snoozed_until: string | null;
  /** Space id this notification was promoted into, when status === 'promoted'. */
  promoted_space_id: string | null;
  /** Phase B.1: category linkage assigned by the B.2 classifier. */
  category_id: string | null;
  /** Phase B.1: goal linkage assigned by the B.2 classifier. */
  goal_id: string | null;
  /** Phase B.2: urgency assigned by the classifier. Defaults to `whenever`. */
  urgency: Urgency;
  /** Phase B.2: classification lifecycle status. */
  classification_status: ClassificationStatus;
  /** Phase B.2: number of LLM attempts made so far (max 3). */
  classification_attempts: number;
  /** Phase B.2: when the classifier last succeeded; null when pending/failed. */
  classified_at: string | null;
  /** Phase B.2: short rationale from the LLM, shown in tooltips + debugging. */
  classification_reasoning: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Default filter for the Feed view: hide everything the user has already
 * dealt with or scheduled away. Phase B will add classifier/urgency filters
 * on top of this.
 */
export interface NotificationListFilter {
  /** Restrict to a specific status. Omit for "active" (the default below). */
  status?: NotificationStatus;
  limit?: number;
  offset?: number;
}
