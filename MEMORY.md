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
