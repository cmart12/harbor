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


## 2026-06-15 — Phase A.3 (Harbor rebrand + packaged build)

- **Rebrand surface (intentionally tiny)**: only the user-facing identity moved from `whim` to `Harbor`. Changed `package.json` top-level `name` (`whim` → `harbor`), `productName` (`whim` → `Harbor`), `build.appId` (`com.patniko.whim` → `com.cmart12.harbor`), `build.productName` (`whim` → `Harbor`); `src/renderer/index.html` and `src/web/index.html` `<title>` elements; `README.md` first heading; `walkthrough/package.json` `name`/`description`. Did not touch internal symbols, file paths, IPC channel strings, the `copilot-whim://` custom protocol, `whim://page/...` deep-link prefixes, code comments, inline renderer copy ("Welcome to whim", etc.), or upstream repo docs.
- **No explicit `BrowserWindow.title`**: `src/main/window-manager.ts:createMainWindow` does not set `title:` on the `BrowserWindow` constructor. Electron derives the window title from `productName` and the loaded HTML `<title>`, so the `package.json` + `index.html` edits cover it without a code change in the main process.
- **Bundle identifier**: packaged app reports `CFBundleIdentifier=com.cmart12.harbor`, `CFBundleName=Harbor`, `CFBundleDisplayName=Harbor`. This is the stable identity that macOS Full Disk Access should now be granted to (the dev Electron host is no longer the binary that needs FDA).
- **userData path did NOT move** — surprise. The brief assumed renaming `package.json:name` would move the userData folder from `~/Library/Application Support/whim` to `~/Library/Application Support/harbor`. It doesn't: `src/main/app-paths.ts` hardcodes `USER_DATA_DIR_NAME = 'whim'` and calls `app.setPath('userData', <appData>/whim)` at import time precisely so the userData path is independent of `productName`. The pin was added so older "Copilot Whim" builds and dev "whim" builds shared one config. Per the brief's "do not change internal symbols containing whim" rule, left it alone. The launched `Harbor.app` confirms this: helper processes start with `--user-data-dir=/Users/chrismartin/Library/Application Support/whim`. If we want userData to move to `harbor`, that is a separate follow-up change to `USER_DATA_DIR_NAME` in `app-paths.ts` (with a one-time migration consideration).
- **Packaging command**: `npm run build:mac` (the existing script — `electron-builder --mac --dir`, no signing/notarization). Output: `build/mac-arm64/Harbor.app`. Build was clean modulo the same upstream electron-builder warnings (duplicate-dep noise from milkdown/codemirror trees, unused `@electron/rebuild` devDep notice). Ad-hoc signature applied by electron-builder.
- **Signing fix-up required to launch**: out of the box the app aborted with `dyld: Library not loaded: @rpath/Electron Framework` because the postinstall `scripts/codesign-dev.sh` signs `node_modules/electron/dist/Electron.app` with the local dev cert (microphone entitlement), but electron-builder then re-signed the bundled `Harbor.app` ad-hoc. The two team IDs didn't match. Fix: `codesign --force --deep --sign - build/mac-arm64/Harbor.app` to ad-hoc sign the whole bundle consistently. After that, direct launch worked and the full Electron helper tree (gpu, network, renderer × 2, copilot SDK) spawned cleanly. Worth automating in a follow-up if we want `build:mac` to be one-shot launchable.
- **Quarantine**: not present on a locally-built artifact (only `com.apple.provenance`, which is benign). If a built `Harbor.app` ever picks up `com.apple.quarantine` (downloaded over the network, attached to mail, etc.), strip it with: `xattr -d com.apple.quarantine "/Users/chrismartin/.copilot/copilot-worktrees/harbor/cmart12-special-meme/build/mac-arm64/Harbor.app"`.
- **Quality bar**: typecheck clean, lint 66 warnings / 0 errors (baseline), `npm run test` 1362 passed (baseline from A.2, delta 0), `npm run build` clean.
- **Packaged app path** (grant FDA here): `/Users/chrismartin/.copilot/copilot-worktrees/harbor/cmart12-special-meme/build/mac-arm64/Harbor.app`.


## 2026-06-15 — Phase B.2 (classifier + active-link warning)

- **SDK choice**: Re-used whim's existing `getEphemeralCopilotClient()` from `src/main/ai.ts`. No subprocess shell-out (that was Funnel's transport, not Harbor's). The client returns `CopilotClient | null`; null is treated as a transient error so a retry can pick up after the user re-auths.
- **Where it runs**: Classifier lives in the main process (`src/main/classifier/`). The macOS poller worker stays focused on reading Notification Center; classifier reads the sidecar DB, calls the SDK, writes back. Keeps the worker simple and means future sources (WorkIQ, Slack) get classification for free by going through `enqueueForClassification`.
- **Single-flight queue**: One Promise chain (`queueTail.then(...)`) so only one SDK round-trip is in flight at a time. `pendingUids` Set deduplicates. Predictable cost; respects rate limits.
- **Batch size 25**: `enqueueManyForClassification` drains N uids in `ceil(N/25)` SDK calls. Picked 25 because each notification block adds ~6 lines to the prompt; 25 keeps a single batch comfortably under a page of text.
- **Retry policy**: 3 attempts with exponential backoff (1s / 5s / 30s). On final failure → `classification_status='failed'` and `notification:updated` emitted so the renderer can repaint with no chip. Feed never blocks on classification — `notification:new` fires before the SDK is invoked.
- **Urgency enum**: `urgent | today | this-week | whenever`. Default `whenever`. Matches Funnel's `Urgency` rubric (urgent=now, today=EOD, this-week=EOW, whenever=FYI). Stored as `TEXT NOT NULL DEFAULT 'whenever'`.
- **Heuristic pre-filter**: Cheap rules run before the SDK call: sender contains `no-reply`/`noreply` → hint `whenever`; body < 30 chars with no `?` anywhere → `whenever`. Returned as a `hint:` line in the prompt so the LLM can override (a no-reply alert can still be genuinely urgent). Also used as the fallback urgency when the LLM omits a row in a batch response — that way we never retry the same row forever.
- **Schema**: 5 new columns on `notifications` (urgency, classification_status, classification_attempts, classified_at, classification_reasoning) added via the same `addColumnIfMissing` PRAGMA pattern A.2 used. 3 new indexes (urgency, classification_status, classified_at). Schema upgrade is idempotent and backward-compatible.
- **Active-link warning (Option 1)**: Archiving a goal or category no longer breaks existing links — the FK remains and the row keeps its tag. The renderer just stops classifying new notifications into archived entities. Before archiving, the UI calls `goal:active-link-count` / `category:active-link-count` and shows a `window.confirm` if `count > 0`. "Active" = `status NOT IN ('archived', 'done', 'promoted')` AND not currently snoozed beyond now (matches the default Feed query).
- **IPC**: 6 new commands (`classifier:reclassify-all`, `:retry-failed`, `:reclassify-one`, `:pending-count`, `goal:active-link-count`, `category:active-link-count`) plus 2 push events (`notification:updated`, `classifier:progress`). All typed via the existing `IpcCommands` table.
- **Renderer**: `feed-store.updateInPlace` swaps a row by `source_uid` while preserving order — used by the `notification:updated` subscription. `renderFeedRow` shows a small color-coded urgency dot + category chip but only once `classification_status === 'done'` so the feed doesn't flicker.
- **Settings classifier status row** lives in Settings → General: shows "Classifier: X pending, Y failed" plus Reclassify all / Retry failed buttons. Subscribes to `classifier:progress`.
- **Periodic sweep**: 60s `setInterval` (unref'd) that picks up any rows that stayed `pending` across a restart or briefly failed. Kicks once on boot too. Stopped cleanly in the main shutdown path.
- **Lockfile delta**: 0. `@github/copilot-sdk` was already a top-level dep from whim; we just import `getEphemeralCopilotClient`.
- **Surprise re: SDK wiring**: `getEphemeralCopilotClient()` returns synchronously — no `await` — and is safe to call from any process tick. But `client.createSession({...})` is async and returns a `CopilotSession` we have to cache; recreating it per notification would burn handshake cost. We cache one session per main-process lifetime and drop it on send error so the next attempt rebuilds. `extractJson` in `ai.ts` matches only `/\{[\s\S]*\}/` (object), so the classifier ships its own array extractor instead of re-using it.
- **Test count**: 1391 → 1425 (+34). 0 new lint warnings.

## 2026-06-16 — Phase B.3 (VIP senders + feed filters/grouping)

- **VIP sender model**: Added a `vip_senders` sidecar table keyed by `email COLLATE NOCASE`. Chose the notifications sidecar DB instead of the event log because VIPs are feed-triage metadata, not canonical space history. Renderer consumes a shared `VipSender` type from `src/shared/notification-types.ts`. Rejected keeping the type main-only because preload and renderer both need it.
- **Computed VIP flag**: `notification:list` now decorates rows with `is_vip` at fetch time via `isVipSender(sender_email)`. Rejected persisting `is_vip` on the notifications table because it would denormalize and require backfills on every VIP edit.
- **Classifier hinting**: Prompt builder now accepts a lowercase VIP email set and emits `vip: true` in matching notification blocks plus a system-note about biasing urgency upward only when other signals support it. Rejected hard auto-promoting VIPs to urgent because that would overfit autoresponders and digests.
- **Feed preferences**: `feed-store` now persists `viewMode` and filter sets in `localStorage` under `harbor:feed-view-mode` and `harbor:feed-filters`. Rejected storing these in app settings because they are renderer-only view preferences and do not need cross-device durability.
- **Feed grouping/filter UX**: Feed remains inline in `app.ts` to match the existing monolithic renderer pattern. Added grouped views (urgency/category/goal), chip filters, active-filter pills, collapsible sections, and VIP stars without moving Feed into a separate view module. Rejected a larger refactor because the brief explicitly asked to keep the diff scoped to the Feed block.
- **Seed backfill**: Default category seeds now include `Code Review` and `Meetings`, plus an `ensureNewSeedCategories()` boot-time backfill so existing installs pick up the two new categories without resetting all category rows. Rejected changing the original empty-seed guard alone because that would miss existing databases.

## 2026-06-16 -- LSUIElement: Harbor is a dockable app, not a menu-bar utility

- **Root cause**: `package.json` `build.mac.extendInfo.LSUIElement` was `true`, inherited from upstream whim. This macOS Info.plist flag makes the app an accessory/background process: no Dock icon, no menu bar ownership, degraded focus behavior. whim uses this intentionally (lives in the system tray), but Harbor is a standalone dockable app.
- **Symptoms**: (1) Spaces canvas opened empty with no editor, (2) permission Approve button didn't register clicks, (3) Harbor never claimed the macOS menu bar. All three traced back to macOS not treating the app as a foreground process.
- **Fix**: Set `LSUIElement` to `false`. One-line change in `package.json`.
- **Rejected alternatives**: Removing the key entirely (works but leaving it explicit documents the decision). Adding `app.dock.show()` at runtime (would fight the plist flag and cause a dock-icon flash on startup).
- **Note**: The diagnostic logging and error boundary committed to `cmart12/fix-spaces-empty-editor` were useful for ruling out code-level canvas bugs but are not needed for this fix. That branch can be deleted after this PR merges.

### Addendum: Auto-updater gate
- Added `disableAutoUpdater: boolean` config key (default `true`) and `HARBOR_DISABLE_UPDATER` env var gate in `initAutoUpdater()`. When either is truthy, the updater sets status to `disabled` and returns early -- no network calls, no "Update failed" banner. This stays `true` until Harbor has a release pipeline. No Settings UI toggle; it is a developer escape hatch only.

## 2026-06-17 -- Audit: sdk-runner.ts FS provider key was wrong

- **Bug confirmed**: `src/main/agents/sdk-runner.ts` line 419 used `createSessionFsHandler` as the options key when calling `client.createSession()`. The Copilot SDK (`@github/copilot-sdk ^1.0.0-beta.10`) expects `createSessionFsProvider`. The SDK checks for this key by name at runtime (`client.js:318`) and throws "createSessionFsProvider is required in session config when sessionFs is enabled in client options" if it is missing. The key is also typed as `createSessionFsProvider` in `types.d.ts:1625`.
- **Impact**: On the ephemeral client (which enables `sessionFs`), every `createSession` call from `sdk-runner.ts` that hit the `isEphemeral && !isCloudSandbox` path would either throw at the SDK validation check or silently skip the in-memory FS provider, meaning agent code paths depending on session FS would get null/fail.
- **Fix**: Renamed `createSessionFsHandler` to `createSessionFsProvider` in `sdk-runner.ts`. Also fixed a stale comment in `ai.ts` (line 430) that referenced the wrong name.
- **Classifier was correct**: `src/main/classifier/classifier.ts` (Phase B.2) already uses `createSessionFsProvider` with an `as any` cast. The B.2 implementer's finding was accurate.
- **TypeScript didn't catch this**: The wrong key was spread via a conditional expression (`...(condition ? { wrongKey: ... } : {})`), which bypasses TypeScript's excess property checking on spread objects. The `as any` cast on the classifier's call was a workaround for a separate typing issue, not related to the key name.
- **No other occurrences**: `createSessionFsHandler` appeared nowhere else in `src/` after the fix.

## 2026-06-17 -- Phase C.1 (WorkIQ source via Copilot SDK)

- **Transport**: Uses `getEphemeralCopilotClient()` from `src/main/ai.ts` to talk to WorkIQ through the Copilot SDK, same as B.2's classifier. Rejected subprocessing the Copilot CLI because Harbor already has an SDK session management pattern and subprocess IPC would add complexity and fragility.
- **Worker thread placement**: Follows A.2's macOS-source pattern exactly: orchestrator (`workiq-source.ts`) in the main process owns DB writes, IPC events, and dedupe. Worker (`workiq-worker.ts`) in a dedicated Node Worker thread owns the SDK session and poll loop. Rejected running the SDK in the main process because long-running SDK calls would block the event loop.
- **Blake3 dedupe**: Ported Funnel's day-bucketed blake3 hash scheme. Hash inputs vary by source: Outlook with deep_link hashes (source, deepLink, day); Outlook without hashes (source, email, subject, day); Teams hashes (source, channel, sender, bodyPrefix100, day). Used `blake3@2.1.4` because `blake3@3.0.0` has a broken transitive dependency (`blake3-wasm@2.1.7` doesn't exist on npm).
- **source_settings table**: Added to `notif-db.ts` with columns: `source` (PK), `enabled`, `last_poll_iso`, `last_error`, `last_cursor_iso`, `updated_at`. One row per source. Default rows seeded for `macos`, `workiq-outlook`, `workiq-teams`. CRUD helpers: `getSourceSettings()`, `setSourceSettings()`, `listSourceSettings()`.
- **Source identifiers**: Two distinct internal source values: `workiq-outlook` and `workiq-teams`. A single worker thread handles both (they come from the same SDK query). The worker discriminates source from the SDK response; the orchestrator writes each item with the correct source field.
- **Polling cadence**: 5-minute interval. WorkIQ data changes slower than macOS Notification Center. Initial backfill: last 7 days on first run (no cursor). Subsequent runs: from cursor.
- **IPC contract**: Added `source:list`, `source:get-status`, `source:set-enabled`, `source:force-rebackfill`, `source:poll-now` commands plus `source:status-changed` push event. SourceController pattern in `source-handlers.ts` avoids circular imports between IPC handlers and main.ts.
- **Settings Sources tab**: New tab in Settings window with rows for macOS NC, WorkIQ Outlook, WorkIQ Teams. Each row shows: name, status badge (Running/Off/Failing), last poll time (relative), last error (truncated with tooltip). Controls: enable/disable toggle, Poll Now button, Force Re-backfill button (with confirm dialog). Live updates via `source:status-changed` subscription.
- **SDK session pattern**: Worker caches one `CopilotSession` for its lifetime. Uses `sendAndWait({ prompt }, timeout)` matching the classifier pattern. On error, drops session and rebuilds. `InMemoryFsProvider` required for `createSession`.
- **Response parsing**: Worker has its own `extractJsonArray()` because the existing `extractJson` in `ai.ts` only matches objects. Parser validates each element has a valid source field before accepting.
- **Deferred scope**: Slack source (future C.x), promote-to-existing-space (C.2), context-gathering agent (C.3).

## 2026-06-17 -- Phase C.1 hotfix (worker electron import bug)

- **Bug**: First smoke test of C.1 failed with `Cannot find module 'electron'` from inside the WorkIQ worker thread. Node `worker_threads` cannot load Electron's `electron` module, and the worker was importing `getEphemeralCopilotClient()` from `src/main/ai.ts`, which transitively pulls electron in. The classifier (B.2) doesn't hit this because it lives in the main process. The macOS worker (A.2) doesn't hit it because it never touches the SDK.
- **Fix (Option A)**: Move the SDK call into the main process; keep everything else in the worker. The worker now posts `{ type: 'request-poll', id, prompt }` to the parent; the parent (orchestrator) holds the cached `CopilotSession`, calls `sendAndWait`, and posts `{ type: 'sdk-response', id, success, text|error }` back. Worker resolves a pending promise keyed by `id`.
- **Why A over B (drop worker, run all in main)**: Smaller diff (~130 vs ~300 lines moved), preserves the A.2 orchestrator+worker pattern, keeps prompt/parser/dedupe/scheduler off the main event loop. The extra round-trip per poll is negligible at 5-minute cadence.
- **Worker is now electron-free**: No imports of `electron`, `../ai`, or `@github/copilot-sdk`. Added a regression test that reads the worker source as a string and asserts those imports stay gone.
- **Session ownership moved**: `cachedSession` and `getSession`/`dropSession` lifted from worker into the `WorkIQNotifSource` class. Added `_setClientFactory()` / `_resetClientFactoryForTests()` injection seam mirroring the classifier's pattern.
- **Pending-request map in worker**: New `pending` Map keyed by request id, with 90s timeout per request and reject-all-on-stop so the worker exits cleanly. Backoff/retry stays in the worker.
- **Verified**: Dev smoke shows worker polls cleanly, SDK round-trips through main, response parses, no electron errors. Per-poll log line: `[workiq-source:worker] poll complete, no new items`.

## 2026-06-17 -- Phase C.1 hotfix #2 (raw worker error capture + main file log)

- **Problem after hotfix #1**: Worker no longer crashes with electron import, but Chris's next smoke surfaced a new crash whose only trace was the generic `last_error = "Worker crashed repeatedly"`. The real error was thrown by the worker but never persisted or logged anywhere readable -- no main-process log file existed, and DevTools is renderer-side only.
- **Fix part 1: capture raw error**: `WorkIQNotifSource` now tracks `lastRawError` (message + first 500 chars of stack) from worker `'error'` events, `'exit'` with non-zero code, and `'error'` messages posted from inside the worker. When `MAX_RESTARTS` is exhausted, the persisted `last_error` is `"Worker crashed repeatedly. Last error: <real cause>"` instead of the bare generic string. A healthy `notifications` poll clears `lastRawError` and resets `restartCount` so a future single crash doesn't immediately re-trip the fallback.
- **Fix part 2: main-process file log**: New `src/main/main-log.ts` wraps `electron-log/main` and writes to `<userData>/logs/main.log`. Idempotent `initMainLog()` called at app-ready in `main.ts`. Exports a `mainLog` proxy that falls back to `console` if init never ran (or failed). Update-service already uses a separate `update.log`; this is intentionally a second file so the two concerns stay separate.
- **Scope discipline**: Only `workiq-source.ts` writes to `mainLog` for now. No broader logging migration -- that's a future pass. The brief was explicit: "Don't try to fix the underlying issue yet. We need data first."
- **New test**: `persists the raw worker error in last_error when worker crashes repeatedly` simulates three crashes through `MAX_RESTARTS`, asserts the persisted `last_error` contains the real error message (`"Cannot find module 'electron'"`) and is NOT the bare generic string.
- **Helper**: `describeError(unknown)` renders Errors as `message\n<stack[:500]>`, strings as-is, objects via `JSON.stringify` with a String() fallback.

## 2026-06-17 -- Phase C.1 hotfix #3 (successful polls never wrote last_poll_iso)

- **Symptom**: Worker logs showed healthy polls (`[workiq-source:worker] poll complete, no new items` every 5min), but `whimAPI.listSources()` returned `last_poll_iso: null` and `last_error: "Worker crashed repeatedly"` (stale from a prior crash). Same for macOS source.
- **Root cause #1 (workiq)**: The worker's `runPoll()` only posted `{ type: 'notifications', ... }` when `items.length > 0`. When the poll succeeded with zero items (the common case), the orchestrator never heard about it -- so `updateSourceAfterPoll()` never ran, `last_poll_iso` stayed null, and `last_error` was never cleared.
- **Root cause #2 (macos)**: A.2 predates `source_settings`. The macOS orchestrator wrote to a separate `notif_meta.macos_cursor` key for cursor tracking, but never touched `source_settings` at all. Healthy polls were invisible to the Sources tab.
- **Fix (workiq)**: Drop the `if (items.length > 0)` gate in `workiq-worker.ts runPoll()`. Always post `{ type: 'notifications', items: [...], cursor }` on a successful poll, even with empty items. The orchestrator's existing `case 'notifications'` already handles empty arrays correctly.
- **Fix (macos)**: New worker outbound message `{ type: 'poll-complete', iso }` posted after every successful `pollOnce` (null return means DB read failed -- no signal). New handler in `macos-source.ts` writes `setSourceSettings('macos', { last_poll_iso, last_error: null })` and broadcasts `source:status-changed`. Cursor tracking stays in `notif_meta` -- not migrating that, scope discipline.
- **Stale "Worker crashed repeatedly" auto-clears**: No explicit migration needed. The first successful poll now writes `last_error: null`, which sweeps the stale value. Tested by seeding the stale string and asserting it's cleared after one healthy zero-item poll.
- **New test**: `writes last_poll_iso on every successful poll (including zero items)` seeds stale crash errors on both sources, emits a zero-item poll, asserts both sources have a fresh `last_poll_iso` AND `last_error: null`.
- **Total: 49 notif-sources tests pass (was 48, +1).**

## 2026-06-17 -- Phase C.1 hotfix #4 (wire workiq MCP into SDK session)

- **Symptom**: After hotfix #3 the source plumbing worked end-to-end and `last_poll_iso` advanced every 5min, but `listNotifications()` never returned a workiq row -- only macos. Worker logs showed `WorkIQ response contained no parseable array` on every poll.
- **Root cause**: The `createSession({...})` call in `WorkIQNotifSource.getSession()` passed no `mcpServers` option, so the session had no tool to actually query Outlook/Teams. The model just returned conversational text instead of a JSON array. Whim's main agent flow uses `getAllMcpServers()` from `src/main/mcp.ts` -- C.1 missed wiring it.
- **Fix**: In `getSession()`, call `mcpServersFactory()` (defaults to `getAllMcpServers`), pluck the `workiq` entry, and pass `{ mcpServers: { workiq: ... } }` into `createSession`. The custom-config copy already wins over discovered-plugin per `getAllMcpServers()` spread order, so config takes precedence automatically when both exist.
- **Why filter to just `workiq`**: The full discovered set (DataDog, Kusto, Slack, etc.) would bloat the tool list and pollute a single-purpose query session. The brief explicitly called for filtering.
- **Graceful fallback**: If no `workiq` MCP is found, log a warning via `mainLog` and continue with no `mcpServers` option. Worker still polls but returns empty results rather than crashing.
- **Injection seam**: New `_setMcpServersFactory()` test-only helper alongside `_setClientFactory()`, mirroring the classifier pattern. `_resetClientFactoryForTests()` resets both.
- **Tests added**:
  - `passes the workiq MCP server into createSession options`: seeds discovered MCPs with workiq + datadog + kusto, asserts createSession options carry only `{ mcpServers: { workiq: ... } }` -- no leakage from unrelated servers.
  - `omits mcpServers from createSession when no workiq MCP is discovered`: seeds only datadog, asserts `opts.mcpServers` is undefined (graceful fallback).
- **Total: 51 notif-sources tests pass (was 49, +2).**

## 2026-06-17 -- Phase C.1 hotfix #5 (workiq session approval allowlist)

- **Symptom**: After hotfix #4 wired the workiq MCP into the session, the SDK still returned no data. The diagnostic log added in `47ef1da` showed the model itself was refusing: "I need to use the WorkIQ tools to access your Outlook emails and Teams messages, but you've rejected each attempt so far (fetch, search_paths, and EULA acceptance)."
- **Root cause**: `WorkIQNotifSource.getSession()` set `onPermissionRequest: async () => ({ kind: 'reject' as const })`. That was a safety copy from the classifier (which makes no MCP calls), and it auto-rejected every workiq tool call + EULA prompt with no UI to surface them through.
- **SDK surface used**: `onPermissionRequest: PermissionHandler` -- a per-session option on `createSession`. The handler receives a `PermissionRequest` with a discriminated `kind` and returns `{ kind: 'approve-once' | 'reject' }`. Whim's main agent flow also uses `yoloMode: true` (a session-level full-bypass), but per the brief's preference for tight allowlisting over YOLO, this fix uses a discriminator-based approval handler.
- **Allowlist policy** (`workiqApprovalHandler`, exported for tests):
  - `kind: 'mcp'` AND `serverName === 'workiq'` → approve
  - `kind: 'extension-management'` AND `extensionName === 'workiq'` → approve
  - `kind: 'extension-permission-access'` AND `extensionName === 'workiq'` → approve (EULA + capability grants)
  - `kind: 'read'` → approve (harmless)
  - Anything else (shell, write, url, memory, custom-tool, hook, or any non-workiq MCP/extension) → reject
- **Why allowlist over YOLO**: A misconfigured prompt or model-drift could otherwise trigger arbitrary side effects (shell, web fetch). The tight allowlist matches exactly the surface the workiq MCP needs.
- **For C.3 (context-gathering agent)**: Same pattern applies. Refactor `workiqApprovalHandler` into a parameterized `createNamespacedApprovalHandler({ servers: string[], extensions: string[] })` when C.3 lands so we don't fork the policy per source.
- **Tests** (+8):
  - Orchestrator: `passes the workiq approval allowlist as onPermissionRequest` (createSession options carry the handler reference).
  - Standalone: 7 cases for the handler covering workiq-MCP-approve, non-workiq-MCP-reject, EULA-approve, non-workiq-EULA-reject, extension-management-approve, read-approve, and reject for every "everything else" kind.
- **Total: 59 notif-sources tests pass (was 51, +8).**

## 2026-06-17 -- Phase C.1 hotfix #6 (SDK timeout + first-run backfill window)

- **Symptom**: After hotfix #5 the approval allowlist worked and Sources flipped to Running, but every poll hit `Timeout after 60000ms waiting for session.idle`. The first-run cost (EULA accept + 7-day backfill + Graph round-trips) genuinely exceeded 60s.
- **Fix 1 (timeout)**: `SDK_TIMEOUT_MS` in `workiq-source.ts` from 60s → **180s (3 min)**. Passed as the second arg to `session.sendAndWait({ prompt }, SDK_TIMEOUT_MS)` per the SDK signature `sendAndWait(options, timeout?)`. Also bumped the worker-side parent-round-trip timeout from 90s → 210s so the orchestrator's 180s fires first and we get a real error message instead of a generic 'SDK request timed out in worker'.
- **Fix 2 (initial backfill)**: `BACKFILL_DAYS = 7` → `BACKFILL_HOURS = 24` in `workiq-worker.ts`. First poll is cheap; subsequent polls advance from `last_cursor_iso` and are tiny. Force re-backfill clears the cursor and lands here again, so this is the rebackfill floor too. Chris can manually pre-seed a longer cursor through `setSourceSettings` if he wants a wider initial sweep.
- **No SDK option change**: `sendAndWait` already takes a per-call timeout. No need to touch session-level config.

## 2026-06-17 -- Phase C.1 hotfix #7 (route workiq logs through mainLog)

- **Why**: PR #11 (`cmart12/harbor-debug-log-tap`, parallel infra branch) makes `mainLog` write to both `<userData>/logs/main.log` and a stable tap at `~/.copilot/sessions-output/harbor-debug.log` (truncated per launch). It updates `macos-source.ts` and `macos-worker.ts` but doesn't touch the workiq files (those aren't on master yet). Folding the same pattern into C.1 now means once both PRs merge, all sources flow through one sink with no follow-up rebase noise.
- **Orchestrator (`workiq-source.ts`)**: replaced every `console.log/warn/error` with the matching `mainLog.info/warn/error`. The `case 'log'` worker-message handler now picks `mainLog.error / mainLog.warn / mainLog.info` instead of the `console.*` triplet, mirroring post-debug-tap `macos-source.ts` exactly.
- **Worker (`workiq-worker.ts`)**: still cannot import `mainLog` (Electron isn't loadable in worker_threads). Added a `workerLog(level, ...args)` helper that posts `{ type: 'log', level, message }` to the parent and a `safeStringify(value)` helper that handles `Error` (`stack ?? message ?? String`), strings, null/undefined, and objects (with a circular-ref fallback to `String(value)`). All existing `post({ type: 'log', ... })` sites now go through `workerLog`. No console use in the worker.
- **Tests**: no test changes needed -- the existing log-passthrough test exercises the parent handler, and the worker tests don't depend on the post shape. Still 59 passing.

## 2026-06-17 -- Phase C.0 (Conversation grouping in Feed)

- **Goal**: Group semantically-redundant notifications (chatty Teams meetings, email threads) into collapsible thread cards in the Feed, keeping it calm.
- **Approach**: Deterministic per-source grouping computed at ingest time. No LLM, no manual merge (both deferred to future phases).
- **Schema**: Added `thread_id TEXT` (nullable, indexed) column to `notifications` via the existing `addColumnIfMissing` pattern. Old rows stay NULL; thread_id is computed on each new ingest.
- **Grouping rules** (pure functions in `thread-id.ts`):
  - macOS: `'macos:' + app_id` (all notifications from the same app share one thread).
  - WorkIQ Outlook: `'workiq-outlook:' + conversation_id` if SDK returns it, else `sender_email:normalizeSubject(subject)`.
  - WorkIQ Teams: `'workiq-teams:' + channel_id + ':' + thread_id_from_response` if both present, else `sender_name:normalizeSubject(subject)`.
  - `normalizeSubject()` strips `Re:`/`Fwd:`/`FW:` prefixes case-insensitively and trims.
- **WorkIQ prompt update**: Prompt now requests `conversation_id` (Outlook), `channel_id`, and `thread_id` (Teams). Parser extracts them; fields are optional (null when SDK doesn't provide them).
- **Feed rendering**: Added "By Thread" view mode to the segmented switcher. Thread cards only appear for groups with count >= 2; singletons render as normal rows. Cards show: latest subject, latest sender, highest urgency chip, VIP star, most common category, "N messages" badge, latest timestamp. Click expands/collapses (state in localStorage). Per-thread bulk actions: Snooze All, Archive All, Done All, Promote.
- **feed-store**: `getGroupedByThread()` returns `{ threads, singletons }`. Thread bulk-action methods (`snoozeThread`, `archiveThread`, `markThreadDone`, `promoteThread`) fan out to per-uid IPC.
- **Tests**: 27 thread-id tests + 12 feed-store thread tests + 3 notif-db round-trip tests = +42 tests.
- **Rejected / deferred**: Manual merge of threads across sources; LLM-powered cross-source grouping; retroactive backfill of historical rows.
- **Conventions upheld**: `{ ok: true as const }` IPC pattern; no em dashes; lint/typecheck baselines maintained; existing code untouched outside scope.

## 2026-06-17 -- Phase C.4 (Slack source via Copilot SDK)

- **What**: Added Slack as a third notification source alongside macOS and WorkIQ. V1 scope: mentions and DMs only, no channel-wide activity.
- **Architecture**: Identical to WorkIQ (Phase C.1). Orchestrator (`slack-source.ts`) owns the SDK session in the main process (workers can't import Electron). Worker (`slack-worker.ts`) runs a 5-minute poll loop with 24-hour initial backfill.
- **Approval handler**: `slackApprovalHandler` approves `kind: 'mcp'` when `serverName === 'slack'`, `kind: 'extension-permission-access'` / `kind: 'extension-management'` when `extensionName === 'slack'`, and `kind: 'read'`. Rejects everything else (shell, write, url, etc.).
- **Dedupe**: Reuses blake3 day-bucketed hashing. Preferred inputs: `(slack, channel_id, source_uid, day)`. Fallback: `(slack, sender_name, bodyPrefix100, day)`.
- **Prompt fields**: `source`, `source_uid`, `sender_name`, `sender_email`, `subject`, `body`, `received_at`, `deep_link`, `channel_id`, `thread_ts`.
- **Follow-up prompt**: Same pattern as C.1 PR #13. When SDK returns empty content + tool requests, retries once with explicit JSON instruction.
- **MCP discovery**: If `getAllMcpServers()` doesn't include a `slack` key, the orchestrator logs a warning and continues without spawning -- no crash.
- **Source settings**: Added `'slack'` to the seed loop. UI Sources tab renders a fourth "Slack" row automatically.
- **thread_id**: Computes `slackThreadId(channel_id, sender_name, subject)` at ingest. Uses `'slack:' + channel_id` when present, else `'slack:' + sender_name + ':' + normalizeSubject(subject)`.
- **Tests**: 57 new tests (32 orchestrator + 25 prompt/parser). Total suite grows accordingly.
- **Deferred**: Channel-wide activity (not V1).
- **Rejected**: Subdividing into `slack-mentions` / `slack-dms` sources (single `slack` source simplifies everything for V1).

## 2026-06-19 -- Phase E.0 (emergency: disable continuous polling)

- **Decided**: Remove all background `setInterval`/`loop()` polling from worker threads (workiq, slack, macOS). Workers now idle after boot and only poll when the user clicks "Poll now" in Settings > Sources. This is a temporary measure to eliminate token consumption until Phase E.1 designs a curation-based workflow.
- **Why**: Continuous 5-min (workiq/slack) and 30-sec (macOS) poll loops consumed tokens even when the user was not actively using the app.
- **What changed**: Removed `POLL_INTERVAL_MS` constants and `loop()`/`void loop()` calls from all three workers. Added `poll-now` handler and `pollNow()` method to macOS (workiq and slack already had them). Wired macOS into the SourceController `pollNow` dispatch in `main.ts`.
- **Rejected**: Reducing poll frequency (still burns tokens silently). Pausing polls when app is backgrounded (complex, still not zero).

## 2026-06-19 -- Phase E.1 (to-do data model + manual CRUD + basic view)

**Decision**: To-dos become the primary object in Harbor. Notifications become the "evidence pool" that feeds into to-dos. This PR (E.1) proves the data shape and UX with manual entry only, before curation automation lands in E.2.

**Data model**:
- `todos` table added to sidecar `notifications.db` with 20 columns (id, title, description, status, source, curation_run_id, evidence_uids, goal_id, category_id, priority, due_at, snoozed_until, space_id, kind, linked_meeting_id, triage_state, created_at, updated_at, completed_at) plus 5 indexes.
- `curation_runs` table added (scaffolding for E.2). Schema only, nothing creates runs yet.
- Categories = projects, Goals = outcomes (locked from B.1). Both are FK references in the todos table.

**Architecture**:
- All CRUD helpers added to `notif-db.ts` (same file, same DB connection): createTodo, getTodo, listTodos, updateTodo, markTodoDone, dismissTodo, snoozeTodo, unsnoozeIfDue, acceptSuggestedTodo, attachSpaceToTodo, plus curation run CRUD.
- 10 IPC commands added (`todo:list`, `todo:create`, `todo:get`, `todo:update`, `todo:done`, `todo:dismiss`, `todo:snooze`, `todo:accept-suggested`, `todo:promote-to-space`, `curation:list-runs`).
- Push event `todos:changed` fires after any mutation; renderer re-fetches.
- `promote-to-space` reuses existing `createSpace` + `materializeSpaceCanvas` plumbing.
- Shared types in `src/shared/todo-types.ts`. Re-exports `SnoozePreset` from notification-types.

**UI changes**:
- To-Dos tab added as first/default tab in top nav (was Feed/Spaces).
- Feed stays as second tab, label unchanged (rename to "Evidence" deferred to E.2).
- New `#todo-view` with inline-add form, category-grouped list, priority/category/goal/due chips, action buttons (Done, Dismiss, Snooze dropdown, Promote to Space), inline title editing.
- Suggested todos get blue left border accent + "Accept" button.
- Snoozed todos hidden by default, visible in expandable section.

**Tests**: 43 new tests (26 DB, 13 store, 4 promote-to-space). Suite total: 1664.

**Deferred to E.2+**:
- Curation runs (morning/evening/manual scheduling, SDK calls).
- Feed rename to "Evidence".
- Notifications-to-todo migration.
- Agent delegation from to-dos.
- On-demand context-gathering.
- Promote-from-notification-to-todo.
- Dedupe heuristic.

**Rejected**: Separate `todo-db.ts` file (single connection in `notif-db.ts` is simpler and avoids dual-connection issues).

## 2025-06-19 - Phase E.2a (morning curation, manual-trigger only)

**What was built**: Full morning curation pipeline fired by a manual "Run morning prep now" button. No scheduler yet (E.2b).

**Architecture decisions**:
- Reused SDK-in-main pattern from workiq-source.ts: single cached CopilotSession, dropped on error, rebuilt on next attempt.
- MCP probe runs once per process lifetime (first curation run). Sends a prompt asking the model to list available WorkIQ/Slack tools. Result cached in memory; informs subsequent prompt construction.
- Curation approval handler follows workiqApprovalHandler pattern: allows workiq + slack MCP/extensions + read; rejects everything else.
- Prompt builder assembles: tool instructions (based on probe), time window, existing open todos (for model-side dedupe awareness), categories/goals/VIPs, and a JSON output schema requesting `{ summary, items[] }`.
- Basic dedupe (V1): case-insensitive containment check + Levenshtein distance < 5. Intentionally simple; LLM-assisted dedupe deferred to E.6.
- All curation-created todos start as `triage_state='suggested'`. User accepts/dismisses from the UI.
- Morning window: 12h. Kickoff (first-ever run): 7 days.
- SDK timeout: 180s (curation takes longer than per-source polls due to tool use).

**New files**: `src/main/curation/morning-curator.ts`, `morning-prompt.ts`, `curation-approval.ts` + 4 test files (40 tests total).

**IPC additions**: `curation:run-morning-now`, `curation:get-progress`, `curation:run-complete` event.

**Renderer additions**: Run button + spinner, "Today's Schedule" section (meeting_prep cards), "Suggested" section with Accept/Dismiss, collapsible run summary banner.

**Deferred to later phases**:
- E.2b: Auto-scheduler (8am/6pm cron-style trigger).
- E.3: Evening recap run.
- E.5: Agent delegation from curation results.
- E.6: LLM-assisted dedupe (replace simple title similarity with model comparison).

**Rejected**: Over-engineering the probe (persisting to DB vs. in-memory cache is sufficient since it only needs to survive one process lifetime).

## 2026-06-19 — Phase E.2a follow-up (evidence deep links on curated to-dos)

Added "Open source" deep links on to-do rows when `evidence_uids` is populated and the referenced notifications have a `deep_link`. Prompt updated with emphatic instruction + example to ensure the model always populates `evidence_uids` for message-sourced to-dos. New IPC `notification:list-by-uids` for batched lookup. Renderer lazily resolves evidence notifications with a session-lifetime cache, renders inline link (single source) or popover (multiple sources). No backfill of existing todos; future curation runs will include evidence consistently. Clicked links open via existing `shell:openExternal` path.
