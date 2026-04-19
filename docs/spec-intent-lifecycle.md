# Intent Lifecycle & Recurrence — Feature Spec

## Problem

Today, intents are flat items: captured, optionally refined by an LLM, and marked done. There is no concept of time, recurrence, or memory. A user who captures "send the weekly status update by Monday" has to re-capture it every week. A user who finishes "review PRs" has no way to recall that standing practice when a similar need arises later.

## Goals

1. **Date-driven intents** — intents with a due date are scheduled in UTC, displayed in local time, and tracked against their deadline.
2. **Standing intents** — intents with no date represent ongoing needs. They stay done when completed, but the system remembers them for future recall.
3. **Smart recurrence** — when a dated intent is completed, the LLM re-evaluates the original text and decides whether it should recur, and if so, when. One-off tasks die; recurring tasks get a new due date automatically.
4. **Recall** — when a user captures a new intent, the system searches past intents (including completed ones) for semantic similarity. If a relevant prior intent exists, it surfaces it.

## Non-goals (this spec)

- Agent integration (executing intents via agents)
- Notifications or reminders
- Calendar sync
- Multi-user or shared intents

---

## Design

### Intent Types

An intent falls into one of two categories based on the presence of a due date:

| Type | Has `due_at`? | Behavior on completion |
|---|---|---|
| **Dated** | Yes | LLM evaluates recurrence → creates next occurrence or stays done |
| **Standing** | No | Stays done. Indexed for future recall |

The user never explicitly picks a type. The LLM infers it from natural language during the initial refinement pass.

### Time Handling

- **Storage**: all timestamps in UTC ISO 8601 (`2026-04-21T17:00:00Z`)
- **Display**: converted to the user's local timezone in the renderer
- **LLM output**: the LLM returns human-readable dates (e.g., "next Monday", "May 1"). The system resolves these relative to the user's local time, then converts to UTC for storage.
- **Date resolution**: a dedicated LLM call (or structured output from the refinement call) converts natural language dates to ISO 8601. The user's current local time is included in the prompt context.

### Schema Changes

```sql
ALTER TABLE intents ADD COLUMN due_at_utc TEXT;      -- ISO 8601 UTC
ALTER TABLE intents ADD COLUMN recurrence TEXT;       -- JSON: LLM's recurrence assessment
ALTER TABLE intents ADD COLUMN parent_id TEXT;        -- links recurrence chain
ALTER TABLE intents ADD COLUMN completed_at TEXT;     -- ISO 8601 UTC
```

- `due_at` (existing) — preserved as the human-readable string from the LLM ("next Friday", "end of month")
- `due_at_utc` — resolved UTC timestamp for sorting and scheduling
- `recurrence` — JSON blob from the LLM's recurrence evaluation (see below)
- `parent_id` — when a recurring intent spawns a new occurrence, the new intent points back to the completed one. This forms a chain.
- `completed_at` — when the intent was marked done

### Recurrence Evaluation

When a user marks a dated intent as done, the system triggers an LLM call:

**Prompt context:**
```
The user completed this intent:
  Original text: "{raw_text}"
  Refined description: "{description}"
  Due date: "{due_at}" ({due_at_utc})
  Completed at: "{completed_at}"
  Current local time: "{local_now}"

Based on the intent's language, should this recur?
Return JSON:
{
  "should_recur": true/false,
  "reasoning": "brief explanation",
  "next_due": "natural language date or null",
  "next_due_utc": "ISO 8601 UTC or null"
}
```

**Examples:**

| Intent | LLM Decision |
|---|---|
| "send weekly status update by Monday" | `should_recur: true, next_due: "next Monday"` |
| "finish the presentation by Friday" | `should_recur: false` |
| "review PRs before standup every day" | `should_recur: true, next_due: "tomorrow before standup"` |
| "file quarterly taxes by April 15" | `should_recur: true, next_due: "July 15"` |

When `should_recur` is true, the system:
1. Stores the recurrence assessment on the completed intent
2. Creates a new intent with `parent_id` pointing to the completed one
3. Sets the new intent's `due_at` and `due_at_utc` from the LLM's response
4. The new intent appears in the active list with a "recurring" indicator

### Recall

When a user captures a new intent, before or after refinement, the system searches for semantically similar past intents:

1. **Search scope**: all intents regardless of status (including `done`)
2. **Method**: embed the new intent's description and compare against stored embeddings, or use the LLM to score relevance against recent intents
3. **Threshold**: only surface matches above a confidence threshold to avoid noise
4. **UX**: if a match is found, show a subtle hint below the captured intent: _"Similar to: {past intent description} (completed 3d ago)"_
5. **User action**: the user can ignore the hint, or tap it to reactivate/clone the past intent

**Recall is passive** — it never blocks capture. The hint appears after the intent is saved, alongside the refinement animation.

### Implementation approach (suggested)

For the initial implementation, recall can use a simple strategy:
- Store a text embedding per intent (via the Copilot SDK or a local model)
- On new capture, compute cosine similarity against the last N completed intents
- Surface the top match if above threshold

A more sophisticated approach (LLM-scored relevance) can replace this later.

---

## UX Changes

### Intent list item

Current:
```
○ Create PowerPoint deck
  👤 Acme · 5h ago
```

Proposed:
```
○ Create PowerPoint deck
  👤 Acme · 📅 Mon Apr 21 · 5h ago
```

- Due date shown in local time, relative when close ("tomorrow", "in 3 days") and absolute when further out
- Overdue intents get a subtle red tint or indicator
- Recurring intents show a small ↻ icon

### Completion flow (dated intent)

1. User clicks the check circle
2. Intent slides into "done" state
3. System sends recurrence evaluation to LLM (background)
4. If recurrence → new intent appears in the list with letter-glow animation
5. Status bar briefly shows: _"↻ Recurring — next due Mon Apr 28"_

### Recall hint

After a new intent is captured and refined:
```
○ Review the PR
  refining...

  💡 Similar: "Review PRs before standup every day" (done 2d ago)
```

The hint fades in after refinement completes and auto-dismisses after a few seconds unless interacted with.

---

## Open Questions

1. **Date parsing accuracy** — should we use a dedicated date-parsing library (e.g., chrono-node) as a fallback when the LLM's date resolution is ambiguous?
2. **Recurrence editing** — should users be able to override the LLM's recurrence decision (e.g., "don't recur this one" or "recur weekly instead of daily")?
3. **Recall storage** — embeddings vs. full LLM scoring for recall. Embeddings are faster but require a local embedding model or API call. LLM scoring is more accurate but slower and more expensive.
4. **Chain depth** — should there be a limit on how many times an intent can recur? Or is the chain unlimited until the user explicitly stops it?
