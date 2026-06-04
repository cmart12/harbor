# Persistence Contract

whim uses a **dual-write architecture**: an append-only event log paired with a
SQLite database. This document defines the rules that all code touching persistent
state must follow.

---

## 1. Source of Truth

| Layer | File | Role |
|-------|------|------|
| **Event log** | `.whim/events.jsonl` | Authoritative record of every state change. Append-only JSONL. |
| **SQLite DB** | `.whim/intents.db` | Derived, disposable materialised view. Rebuilt on every startup. |

The database is **deleted and recreated** from the event log each time
`initDatabase()` is called (see `database.ts`). Never treat the DB as the source
of truth.

---

## 2. Write Rules

1. **Log first** — every state change MUST be appended to the event log before
   the corresponding database write.
2. **DB follows** — after the event is durably written (`fsync`), apply the same
   change to SQLite.
3. **Safe to lose the DB** — if the database file is corrupt or missing, delete
   it and call `initDatabase()`. The event log will be replayed to reconstruct
   all state.
4. **DB failure is non-fatal** — if the SQLite write fails after the event was
   logged, the data is safe. The next startup replay will recover it.

### Sequence diagram

```
caller ──► appendEvent(logPath, op, data)   // 1. fsync to .jsonl
       ──► db.prepare(…).run(…)             // 2. apply to SQLite
```

---

## 3. Read Rules

- **Reads come from SQLite** — queries hit the database for performance (indexes,
  joins, sorting).
- **The event log is read only during startup replay** (`replayLog`) or disaster
  recovery. It is never queried at runtime for regular reads.

---

## 4. Event Types

All events share the `LogEvent` envelope:

```ts
interface LogEvent {
  ts: string;           // ISO-8601 timestamp
  op: string;           // event type (see below)
  data: Record<string, any>;
}
```

### Intent events

| `op` | Payload (`data`) | Description |
|------|-------------------|-------------|
| `intent.create` | Full intent fields: `id`, `description`, `body`, `raw_text`, `client`, `due_at`, `due_at_utc`, `recurrence`, `completed_at`, `folder`, `attachments` (JSON string), `status`, `created_at`, `updated_at` | Creates a new intent. |
| `intent.update` | `id`, `fields` (object of changed columns) | Partial update of an existing intent. Only changed fields appear in `fields`. |
| `intent.assign_folder` | `id`, `folder` | Assigns a workspace folder to an intent. |
| `intent.delete` | `id` | Soft-deletes an intent (row removed from DB). |

### Intent-event (scheduling) events

| `op` | Payload (`data`) | Description |
|------|-------------------|-------------|
| `intent_event.log` | `id`, `intent_id`, `event_type`, `due_at`, `due_at_utc`, `completed_at`, `recurrence_json`, `created_at` | Records a scheduling/lifecycle event for an intent. |

### Canvas agent events

| `op` | Payload (`data`) | Description |
|------|-------------------|-------------|
| `canvas_agent.created` | `id`, `intent_id`, `selected_text`, `session_id`, `pid`, `status`, `created_at`, `updated_at` | Registers a new canvas agent run. |
| `canvas_agent.updated` | `id`, `status`, `pid`, `updated_at` | Updates the status (and optionally PID) of a canvas agent. |

### Agent session events

| `op` | Payload (`data`) | Description |
|------|-------------------|-------------|
| `agent_session.created` | `id`, `session_id`, `intent_id`, `prompt`, `status`, `summary`, `working_dir`, `source`, `created_at`, `updated_at` | Registers a new agent session. |
| `agent_session.updated` | `id`, `status`, `summary` (nullable), `updated_at` | Updates the status/summary of an agent session. |
| `agent_session.deleted` | `id` | Deletes an agent session. |

### Snapshot events

| `op` | Payload (`data`) | Description |
|------|-------------------|-------------|
| `snapshot` | `intents` (array), `intent_events` (array) | Bulk-inserts a full snapshot. Used for migration or seeding. |

---

## 5. Rebuild Procedure

The database is rebuilt automatically on every startup:

```ts
// database.ts — initDatabase()
// 1. Delete existing DB and journal files
// 2. Create fresh schema (intents, canvas_agents, agent_sessions, intent_events)
// 3. replayLog(eventLogPath, db) — apply every event in order
```

To manually rebuild:
1. Delete `.whim/intents.db` (and any `-journal`, `-wal`, `-shm` siblings).
2. Restart the application. `initDatabase()` replays the event log.

The integration tests in `src/main/integration.test.ts` validate that every
entity type (intents, canvas agents, agent sessions, intent events, folder
assignments) survives a full rebuild cycle:

- `rebuild()` calls `initDatabase()` which deletes the DB and replays the log.
- Tests assert that all fields match their pre-rebuild values.

---

## 6. Current Gaps

The following operations write directly to SQLite **without** an event log entry.
They are intentional exceptions today but should be understood:

### Intentionally DB-only (per-machine / derived state)

| Function | Why no event |
|----------|-------------|
| `mergeSessionIds()` | Session IDs are per-machine (stored in local config), not shared across devices. |
| `setIntentSessionId()` | Same — per-machine session binding. |
| `syncCanvasContent()` | Derived from canvas files on disk; re-read on every startup. |
| `updateCanvasContent()` | Cache of on-disk file content; regenerated on rebuild. |

### Replay gap

| Issue | Detail |
|-------|--------|
| `agent_session.deleted` not handled in `applyEvent()` | `deleteAgentSession()` appends an `agent_session.deleted` event, but `applyEvent()` in `eventlog.ts` has no case for it. During replay the event is silently warned and skipped, so deleted sessions reappear after rebuild. |
