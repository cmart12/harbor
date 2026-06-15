## 2026-06-15 — Harbor fork created from patniko/whim

Funnel app's notification triage being merged into whim. See `~/.copilot/session-state/727986f0-3f18-4cab-a090-e8c253f2de8d/plan.md` for the full pivot plan.

- Stack: Electron + TypeScript + better-sqlite3 + vitest + oxlint
- Default branch: master (NOT main)
- Upstream: patniko/whim (configured as `upstream` remote)
- Phase A.1: build green + codebase notes + empty Feed tab (no backend yet)
- Phase A.2 next: macOS notif reader port + notifications table + Feed view + promote-to-space

## 2026-06-15 — Phase A.1 implementation decisions

- **Tab system**: whim uses a single `#filter-bar` of `.filter-btn[data-filter=...]` buttons, no icons, text labels only. Internal filter values (`open`/`agents`/`skills`/`closed`) don't match display labels (Spaces/Workers/Skills/Activity). Added `'feed'` as a new value with label "Feed".
- **Feed placement**: Put Feed FIRST in `filterOrder` and as the first button in `#filter-bar`. Conceptually it's the inbox feeding into Spaces. Did NOT change `currentFilter` default — still starts on `'open'` (Spaces) so existing behavior is preserved.
- **No new renderer file**: Followed whim's monolithic `app.ts` + `#space-list` pattern by adding a sibling `#feed-placeholder` div in `index.html` and toggling its visibility from `setFilter()`. No new view module — matches conventions used by Skills/Activity tabs which are also rendered inline in `app.ts`.
- **Test placement**: Extended `src/renderer/state/space-store.test.ts` rather than creating a new file. `space-store.ts` owns the `SpaceFilter` type and is the right place to assert the Feed filter contract.
- **Schema/event-log architecture noted**: whim has NO migrations table. `database.ts:createSchema` runs `CREATE TABLE IF NOT EXISTS` on every startup, and `eventlog.ts` replays JSONL events to re-materialize SQLite. This has implications for A.2 — see HARBOR_NOTES "Open questions".

## 2026-06-15 — Phase A.2 (notif ingestion + Feed view)

- **Sidecar SQLite**: `notifications.db` lives at `<userData>/notifications.db` next to whim's `whim.db`. Notifications are a high-volume cache over remote sources (macOS Notification Center today; WorkIQ/Slack later) so replaying them through the event log on every cold start was the wrong tradeoff. The one durable fact we DO care about — "Space X was promoted from notification Y" — rides through the event log on the `space:create` payload, so the linkage survives even if `notifications.db` is deleted. Pragmas mirror Funnel's `store.rs` (`journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`). Status enum is code-only (no CHECK constraint) so widening it stays a one-line change. Indexes on `received_at DESC`, `status`, `snoozed_until`.
- **Worker thread**: macOS notif reader runs in a dedicated Node `worker_threads` worker (`src/main/notif-sources/macos-worker.ts`) so reading `~/Library/Group Containers/group.com.apple.usernoted/db2/db` and parsing Cocoa NSDate timestamps stays off the main thread. Orchestrator in `src/main/notif-sources/macos-source.ts` owns spawn/restart/shutdown. Followed the worker pattern used by whim's voice Whisper worker. Future sources implement `NotifSource` from `src/main/notif-sources/types.ts`.
- **macOS dedup**: Used UUID `source_uid` + `INSERT OR IGNORE`. blake3 day-bucketed hash from Funnel's `workiq_source.rs` is deferred to Phase C where WorkIQ + Slack will need actual content-based dedup. Not adding `blake3` dep until then.
- **`source_notification_id` on `spaces`**: Added nullable `TEXT` column to `spaces` table. Threaded through `createSchema` in `database.ts`, both replay INSERTs in `eventlog.ts` (space.create and snapshot.replay), `ALLOWED_SPACE_FIELDS` in `eventlog.ts`, `compaction.ts` CREATE TABLE + snapshot SELECT, `Space` shared type, `CreateSpaceInput.sourceNotificationId`, and the test schema in `eventlog.test.ts`. Promote-to-new-space writes a normal `space:create` event with the field populated so canonical state still rebuilds from the event log.
- **Snooze presets**: `1h` / `3h` / `tomorrow_9am` / `next_monday_9am`. Math runs in LOCAL time (so "tomorrow 9am" matches the user's clock) then stored as UTC RFC3339 in `snoozed_until`. Ported Funnel's `notif_actions.rs::compute_snooze_until` semantics verbatim, including the Monday-before-9am-returns-today rule. 8 Funnel tests ported to TS in `notif-snooze.test.ts`.
- **Done vs Archive kept distinct**: `done` for "I handled this", `archived` for "irrelevant". Both hide from the default Feed query but the distinction lets Phase B classifier learn from each independently.
- **Status enum**: `unread | read | snoozed | archived | done | promoted`. Code-only union in `src/shared/notification-types.ts`. Default Feed list query hides `archived | done | promoted` AND future-snoozed (i.e. `status = 'snoozed' AND snoozed_until > now`).
- **IPC contract**: 6 new commands (`notification:list`, `:promote-to-new-space`, `:open-link`, `:snooze`, `:archive`, `:mark-done`) plus 1 push event (`notification:new`). All typed via the existing `IpcCommands` table; handler returns use `{ok: true as const}` to satisfy the literal-true result type.
- **Feed view kept inline in `app.ts`** per pre-decision. Added `renderFeedView`/`renderFeedRow`/`relativeTime`/`showFeedToast` next to `renderAgentSummary`. Module-level subscription to `feedStore` + `onNotificationNew` listener so push events prepend new rows without a refetch. `setFilter` lazy-loads on first Feed activation.
- **Feed store** (`src/renderer/state/feed-store.ts`) mirrors `space-store` subscribe/notify shape. Optimistic remove on action success; keeps the row on failure.
- **Toast UX**: lives inside `#feed-placeholder` so it auto-hides on tab switch. Clickable variant navigates to Spaces via `setFilter('open')`. Not a generic notification system — adequate for A.2.
- **New deps**: `bplist-parser@0.3.2` (NSKeyedArchiver decode for macOS notif payloads; ships its own `.d.ts`). Two packages total. No blake3.
- **Worker path resolution**: `path.join(__dirname, 'notif-sources', 'macos-worker.js')` works because `tsc` preserves the directory layout into `dist/main/notif-sources/macos-worker.js`. Verified post-build.
- **Permissions**: macOS Full Disk Access required to read the Notification Center DB. Per brief, single log warning on denial; full onboarding flow is Phase D.

