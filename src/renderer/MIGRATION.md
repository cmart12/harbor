# app.ts → React Migration Plan

This document tracks the incremental migration of `app.ts` (3,459 lines) into
React components backed by typed stores and the IPC client.

## New Infrastructure (ready to use)

| Module | Purpose |
|--------|---------|
| `ipc-client.ts` | Typed accessor for `window.intentAPI`; re-exports all shared types |
| `state/intent-store.ts` | Reactive store for intents, filter, search, focus, canvas state |
| `state/agent-store.ts` | Reactive store for agents, approvals, steps, presence |
| `views/Settings.tsx` | Skeleton – settings panel |
| `views/IntentList.tsx` | Skeleton – filterable intent list |
| `views/Timeline.tsx` | Skeleton – activity timeline |
| `views/CaptureForm.tsx` | Skeleton – text/voice capture form |

## Current app.ts Section Map

| Lines | Section | Target Component / Store |
|-------|---------|--------------------------|
| 1–155 | Interfaces & type definitions | `shared/types`, `shared/ipc-contract` (already extracted) |
| 156–158 | Canvas window mode detection | Canvas component (future) |
| 159–206 | DOM element references | Removed when each component owns its own DOM |
| 208–218 | Status bar helpers | Shared utility / toast component |
| 219–227 | Workers badge | `AgentStore` + badge component |
| 228–292 | Filter bar | `IntentStore.setFilter()` + `IntentList` |
| 293–322 | New Agent button | `IntentList` or toolbar component |
| 323–333 | Launch CLI button | `IntentList` or toolbar component |
| 334–360 | Settings modal (open/close) | `Settings` component |
| 361–423 | Pin toggle, model select, settings load | `Settings` component |
| 424–452 | Theme switching | `Settings` component |
| 453–701 | Agent Personas (CRUD, forms, rendering) | `Settings` component |
| 702–903 | MCP Servers (CRUD, forms, rendering) | `Settings` component |
| 905–1061 | CLI Tools (CRUD, forms, rendering) | `Settings` component |
| 1063–1161 | Voice input (recording, transcription) | `CaptureForm` component |
| 1162–1289 | Auto-resize, live search, search mode | `CaptureForm` component |
| 1290–1388 | Text refinement animation | `CaptureForm` component |
| 1389–1694 | Intent CRUD (`renderList`, `refreshList`, inline rendering) | `IntentList` + `IntentStore` |
| 1695–2103 | Agent step & approval tracking, agent list rendering | `AgentStore` + agent list component |
| 2104–2189 | Form submit, IPC listeners (LLM, recurrence, recall) | `CaptureForm` + event wiring |
| 2190–2221 | Session launch | `IntentList` action / agent component |
| 2222–2291 | Workspace & CLI path settings | `Settings` component |
| 2292–2439 | Inline editing (description, date, body) | `IntentList` inline-edit sub-components |
| 2440–2511 | Attachments, dismiss query | `IntentList` attachment sub-component |
| 2512–2570 | Focus mode | `IntentStore` + focus banner component |
| 2571–2649 | Timeline view | `Timeline` component |
| 2650–2686 | Toggle status, delete, refresh title | `IntentList` actions (already in IntentStore) |
| 2687–2946 | Canvas view (open, save, close, title edit) | Canvas component (future) |
| 2947–3060 | Canvas History panel | Canvas history component (future) |
| 3061–3140 | Canvas Agents panel | Canvas agents component (future) |
| 3141–3181 | Agent Chat view | Agent chat component (future) |
| 3182–3210 | Agent Presence management | `AgentStore.presence` |
| 3211–3249 | Global agent status/approval listeners | `AgentStore` event wiring |
| 3250–3406 | Init + keyboard navigation + global listeners | Root `App` component |
| 3407–3459 | Canvas popout window mode | Canvas component (future) |

## Migration Checklist

Each item below represents a discrete migration unit. They can be done in any
order, though earlier items tend to be simpler.

- [ ] **Settings panel** (~730 lines: 334–452, 453–701, 702–903, 905–1061, 2222–2291)
  Move theme, pin, model, persona, MCP, CLI-tools, workspace, and CLI-path
  DOM logic into `Settings.tsx`. Wire to `ipc-client.getAPI()`.

- [ ] **Capture form** (~330 lines: 1063–1161, 1162–1289, 1290–1388, 2104–2189)
  Move voice input, auto-resize, live search, text refinement, and form
  submit into `CaptureForm.tsx`. Wire to `IntentStore` for search state.

- [ ] **Intent list** (~640 lines: 228–333, 1389–1694, 2292–2511, 2512–2570, 2650–2686)
  Move filter bar, intent rendering, inline editing, attachments, focus
  mode, toggle/delete/refresh into `IntentList.tsx`. Wire to `IntentStore`.

- [ ] **Agent list & tracking** (~410 lines: 1695–2103, 3211–3249)
  Move agent card rendering, step/approval tracking, global agent listeners
  into a new agent list component. Wire to `AgentStore`.

- [ ] **Timeline** (~80 lines: 2571–2649)
  Move event loading and timeline rendering into `Timeline.tsx`.

- [ ] **Canvas view** (~520 lines: 2687–3140, 3407–3459)
  Move canvas open/save/close, history panel, agents panel, popout mode
  into a new Canvas component.

- [ ] **Agent Chat** (~40 lines: 3141–3181)
  Move agent chat open/close into an AgentChat component.

- [ ] **Agent Presence** (~30 lines: 3182–3210)
  Wire presence syncing through `AgentStore.presence`.

- [ ] **Init & globals** (~160 lines: 1–155, 159–206, 208–227, 3250–3406)
  Replace with a React root `App` component that composes the above.
  Move keyboard navigation into React event handlers or a hook.

## How to Migrate a Section

1. **Identify the section** in the table above and locate the line range in `app.ts`.
2. **Move DOM logic** into the target React component. Replace `document.getElementById` calls with React refs or state.
3. **Replace IPC calls** — use `getAPI()` from `ipc-client.ts` instead of `window.intentAPI`.
4. **Wire to stores** — read/write state through `intentStore` or `agentStore` instead of module-level variables.
5. **Delete the old code** from `app.ts`.
6. **Run `npm test`** to verify nothing breaks.
7. **Check the checkbox** in this file.

## Notes

- Skeleton components exist in `src/renderer/views/` but contain placeholder
  markup only. Each migration step fills in the real implementation.
- The stores (`intent-store`, `agent-store`) are designed for
  `useSyncExternalStore` so React components can subscribe without additional
  glue.
- Canvas-related sections are the largest single block (~520 lines) and will
  likely warrant their own dedicated component directory.
