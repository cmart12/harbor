# Harbor notes — whim codebase, captured in Phase A.1

A working reference for anyone (including future me) picking up Harbor work. Written after a first deep read of the whim codebase we forked from `patniko/whim`, plus a skim of the existing docs (`docs/architecture.md`, `docs/spec-intent-lifecycle.md`, `docs/user-guide.md`).

If something here drifts from reality, fix it. These notes are meant to age well, not to be authoritative.

## How whim's main process is wired

The Electron main process lives entirely under `src/main/`. The pieces that matter for Harbor:

### `src/main/database.ts`
- Owns the **single better-sqlite3 connection** for the whole app.
- Exposes `initDatabase`, `closeDatabase`, plus a wide surface of CRUD helpers (spaces, canvas agents, agent sessions, skills, etc).
- Owns the schema: `createSchema()` runs `CREATE TABLE IF NOT EXISTS …` for every table on startup. There is **no formal migrations table** — see the "SQLite migrations" section below.
- Cooperates with the event log: writes go through `appendEvent` so the JSONL log is the durable source of truth, and the SQLite file is treated as a rebuildable cache.
- Uses `db-fingerprint.ts` to skip replay when nothing changed. `closeDatabase` refreshes the fingerprint sidecar so the next boot can fast-path.

### `src/main/eventlog.ts`
- The **append-only JSONL store**. Every state-changing operation calls `appendEvent(logRoot, op, data)` which writes one line to the active segment under `<workspace>/events/`.
- `resolveActiveSegment` (in `log-store.ts`) handles month buckets and 25 MB rotation, so callers stay ignorant of file layout.
- `replayLog(logRoot, db)` re-materializes the SQLite tables by reading every segment in chronological order. This is what runs at boot when the fingerprint check fails.
- The allow-list `ALLOWED_SPACE_FIELDS` at the top is the schema gate for replay — any new column needs to be added here too, or replay will silently drop it.

### `src/main/agent-service.ts`
- Orchestrates **long-running agent sessions** (Workers). Spawns Copilot CLI/SDK processes, tracks their lifecycle, streams chat events back into SQLite via `database.ts` helpers, and dispatches IPC events for the renderer.
- Pairs with `src/main/agents/` (sdk-runner, cli-runner, cca-runner, notifier, permissions) — these are the per-flavor adapters.
- The "Workers" tab in the renderer is mostly a view onto state this service owns.

### `src/main/ipc.ts` and `src/main/ipc/`
- `ipc.ts` is a thin entry point. The real work happens in `src/main/ipc/index.ts`, which calls eight `register*` functions:
  - `register{Space,Agent,Canvas,Settings,Chat,Workspace,Skill,Export}Handlers`.
- Each `*-handlers.ts` file owns one IPC domain and registers its channels with `ipcMain.handle`. They use the typed helper in `typed-handler.ts` which validates inputs against the shared contract.
- The shared contract lives in `src/shared/ipc-contract.ts`. Main and renderer both import it, so channel names and payload shapes can't drift.

### Supporting modules to know about
- `workspace.ts` — file-system layer for the on-disk workspace (`<whim>/spaces/<slug>/canvas.md`, `events/`, `agents/`, etc).
- `subagent-content-store.ts` — content-addressable blob store for large agent outputs.
- `web/` — the local web server that serves the canvas to mobile/browser clients.
- `voice/` — Whisper integration, runs in its own worker.

## How IPC works

The boundary is conventional Electron `contextBridge` + `ipcMain.handle`, with a typed contract sitting in the middle.

- **Preload** (`src/preload/preload.ts`) is what exposes `window.whimAPI` to the renderer via `contextBridge.exposeInMainWorld`. Every method here just delegates to `ipcRenderer.invoke('domain:action', payload)`.
- **Channel naming**: `domain:action`. Examples:
  - `space:create`, `space:list`, `space:update`, `space:delete`
  - `agent:launch`, `agent:list-all`, `agent:cancel`
  - `canvas:read`, `canvas:write`
  - `settings:get`, `settings:set`
  - `chat:send`, `chat:history`
  - `workspace:get-path`, `workspace:set-path`
  - `skill:list`, `skill:read`
  - `export:markdown`
- **Renderer access** goes through `src/renderer/ipc-client.ts`. It exports `getAPI()` which returns the bridged `window.whimAPI`, and `getIpcBridge()` which wraps it in a subscriber-friendly store for components that need to react to push events from main.
- **Push events from main → renderer** use `webContents.send('channel', payload)`. The renderer subscribes via `getAPI().on(...)` (also bridged through preload). Examples: agent chat events, canvas reload signals.
- **Type safety**: `src/shared/ipc-contract.ts` defines `WhimAPI` (renderer-facing surface) and the input/output types per channel. Main-side `typed-handler.ts` enforces the same shape on registration.

To add a new IPC channel for Harbor:
1. Add the channel + payload types to `src/shared/ipc-contract.ts`.
2. Register the handler in the relevant `src/main/ipc/*-handlers.ts` (or create a new one and wire it up in `index.ts`).
3. Add the method to `src/preload/preload.ts`.
4. Call it from the renderer via `getAPI().<method>(...)`.

## How tabs work in the renderer

This is the part Phase A.1 actually touches, so it's worth being concrete.

- **Top-level tabs are declared in `src/renderer/index.html`** inside `<div id="filter-bar" role="tablist">`. Each tab is a `<button class="filter-btn" data-filter="<value>" role="tab">`. They are **text-only, no icons**. The current set:
  - `data-filter="feed"` → label "Feed" (Phase A.1, this PR)
  - `data-filter="open"` → label "Spaces"
  - `data-filter="agents"` → label "Workers"
  - `data-filter="skills"` → label "Skills"
  - `data-filter="closed"` → label "Activity"
  - Note: the `data-filter` values do NOT match the display labels. The values are legacy from when "Spaces" was the only concept and tabs filtered the space list. Don't rename them without a careful sweep.
- **Active-tab state lives in two places**:
  1. `currentFilter` local in `src/renderer/app.ts` (typed union, see `filterOrder`). This is what `setFilter()` mutates on click.
  2. `spaceStore.setFilter()` in `src/renderer/state/space-store.ts`, kept in sync from `setFilter()`. The store's `SpaceFilter` type is the canonical union — add a new value here first, then propagate.
- **Click handler**: delegated from `#filter-bar` in `app.ts` (around line 780), reads `data-filter`, calls `setFilter(value)`.
- **`setFilter(value)` is the dispatch hub**. It:
  - Toggles `.active` and `aria-selected` on the right button.
  - Hides/shows the capture form (`#space-form`) depending on tab.
  - Hides/shows the agent summary, "new agent" / "launch CLI" buttons, workers badge.
  - For Feed: hides the space list and shows `#feed-placeholder`.
  - Calls `spaceStore.setFilter(value)` and re-renders.
- **`render()` early-returns per tab**. For non-Spaces tabs (`agents`/`skills`/`closed`/`feed`) it skips the space-list render path entirely. Each tab that has content gets its own render branch.

**To add a sibling tab (the Phase A.1 pattern)**:
1. Add `'<value>'` to the `SpaceFilter` union in `src/renderer/state/space-store.ts` and handle it in `getFilteredSpaces()` (return `[]` if it's not a space list).
2. Add the same value to the `currentFilter` typed union and the `filterOrder` array in `src/renderer/app.ts`.
3. Add the `<button>` to `#filter-bar` in `src/renderer/index.html`.
4. Add a placeholder/content element near `#space-list` and toggle it from `setFilter()`.
5. Add an early-return branch in `render()` for the new filter.
6. Add a test in `space-store.test.ts` covering the filter contract.

Phase A.1 deliberately matched this pattern verbatim rather than introducing a router or a view module. If we ever do introduce one, it's a global change that should land as its own PR.

## How SQLite migrations work

Short answer: **there isn't a migrations table**. The model is "event log is truth, SQLite is a cache".

- `database.ts:createSchema()` runs `CREATE TABLE IF NOT EXISTS` for every table on every startup. New columns are added the same way (also `IF NOT EXISTS` via `ALTER TABLE … ADD COLUMN` patterns) or by adding them to `CREATE TABLE` and relying on a rebuild from the event log.
- On startup, `initDatabase` decides between:
  - **Fast path**: if `db-fingerprint.ts:canSkipReplay` says the sidecar fingerprint matches the current log + SQLite state, open the existing DB and use it as-is.
  - **Slow path**: otherwise, drop/recreate tables and call `replayLog(logRoot, db)` to re-materialize from the JSONL segments. This is the "migration" — the schema is whatever `createSchema` declares, and the data is whatever the event log replays into it.
- The implication is that **schema changes are cheap, but they require care on two fronts**:
  - Update `createSchema` so new installs and rebuilds have the column.
  - Update `eventlog.ts` allow-lists / replay handlers if the new column is sourced from the log. Otherwise replay will drop it.
- Tables currently in `database.ts` (as of A.1):
  - `spaces`, `canvas_agents`, `agent_sessions`, `agent_chat_events`, `space_events`, `skills`, `subagent_records`, `subagent_tool_calls`.
- There is also `subagent-content-store.ts` which manages its own content-addressable blob DB next to the main file.

For Harbor's notifications table, this is the open question — see "Open questions for Phase A.2" below.

## Conventions to match

- **File organization**: main code under `src/main/`, renderer under `src/renderer/`, preload under `src/preload/`, shared types/contracts under `src/shared/`, mobile/browser companion under `src/web/`.
- **Test files**: colocated next to source as `*.test.ts(x)`. Vitest config uses `environment: 'node'` by default; tests that need DOM include a `// @vitest-environment happy-dom` directive at the top of the file.
- **Test style**: prefer extracted, store-style modules with subscriber patterns (see `src/renderer/state/space-store.ts`). The monolithic `app.ts` (~8.5k lines) is not directly testable; tests cover the stores and views it composes.
- **Lint**: oxlint 1.61 driven by `.oxlintrc.json`. Baseline is 66 warnings, 0 errors. `no-console` is off. Don't touch unrelated warnings — clean them up in their own PR if they bother you.
- **Typecheck**: `npm run typecheck` runs `tsc -p tsconfig.main.json` which excludes the renderer. The renderer is built via esbuild and has a number of pre-existing TS warnings under the full `tsconfig.json` that we leave alone.
- **Naming**: kebab-case for files (`space-store.ts`, `agent-handlers.ts`), `PascalCase` for types/classes, `camelCase` for functions and IPC method names on the renderer side; `domain:action` for IPC channel strings.
- **No em dashes** in Harbor PRs and docs. (Carryover convention.)
- **Commits** include `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.
- **Branch naming**: Phase-scoped (`phase-a1-feed-tab-shell`). The session worktree tool may prepend a user prefix; that's cosmetic.

## Open questions for Phase A.2

These are the things I noticed during the deep-read that A.2 (notif ingestion + Feed view + promote-to-space) will need to resolve. None are blockers, but each deserves a quick decision before code lands.

1. **Where do notifications live? Same SQLite as spaces, or a sidecar DB?**
   whim's model is "event log is truth, SQLite is a rebuildable cache". Notifications come in as a high-volume firehose (every macOS notification, many discarded by classifier). Routing all of them through the existing JSONL event log would balloon the log size and slow replay. Options:
   - **(Recommended) Sidecar SQLite** — separate file (`notifications.db` next to `whim.db`) with its own schema, no event log involvement. Promote-to-space writes a normal `space:create` event to the main log when a notification is promoted, so the canonical app state still rebuilds from the main log.
   - **Same DB, no event-log entries** — share the SQLite file but exclude notifications from `replayLog`. Saves a file but couples lifecycles.
   - **Same DB, full event-log entries** — keeps everything uniform but bloats the log indefinitely.
2. **Notification reader process model.** Funnel ran the macOS notif reader inside the Tauri main process. whim's main process is already busy (Electron, voice worker, agents). Should the reader run in:
   - A dedicated Node worker (`worker_threads`)?
   - A child process spawned at boot?
   - Inline in main with a guarded poll interval?
3. **Schema for `notifications`**. Funnel's Rust struct in `~/funnel-app/src-tauri/src/store.rs` is a fine starting point, but we should confirm field names and JSON shapes before porting so the renderer types line up.
4. **Promote-to-space UX**. The existing `space:create` IPC takes `CreateSpaceInput`. Promoting a notification likely needs an extension — at least a `source_notification_id` foreign key on `spaces` so we can render the provenance. Confirm before adding the column (it has event-log implications per the section above).
5. **Feed view rendering**. Whim's existing tabs all render through `app.ts`. Feed is going to be more like a chronological timeline than a card list. Worth deciding early whether to keep it in `app.ts` (match conventions) or carve out a dedicated `src/renderer/views/feed.ts` module. Phase A.1 stays inline; A.2 should pick.
6. **Snooze / Done-vs-Archive lifecycle**. Funnel had a real opinion about Done vs Archive and snooze preset math (see Funnel's `MEMORY.md`). whim has no equivalent yet. Decide whether to port the Funnel model verbatim or align with whim's existing `status` enum on spaces.

## Useful pointers

- `docs/architecture.md` — high-level whim architecture, complements this doc.
- `docs/spec-intent-lifecycle.md` — the "intent" model that became Spaces. Worth reading before designing the promote-to-space flow in A.2.
- `docs/user-guide.md` — user-facing surface; helpful when sanity-checking that Harbor changes don't break documented behavior.
- `~/funnel-app/src-tauri/src/macos_notif.rs` — the Rust notif reader to port for A.2 (READ-ONLY reference).
- `~/funnel-app/src-tauri/src/store.rs` — Rust SQLite patterns and the notification schema we're porting.
- `~/funnel-app/MEMORY.md` — prior Funnel decisions, especially the Done-vs-Archive lifecycle and snooze preset math.
