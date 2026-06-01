// ── Auto-update ────────────────────────────────────────────────────────────
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'disabled';
export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  error?: string;
  progress?: number;
}

export interface Attachment {
  type: 'url' | 'file';
  name: string;
  url: string;
  /** Relative path within the space folder (for type: 'file') */
  relativePath?: string;
  /** MIME type of the file */
  mimeType?: string;
}

export interface CanvasAgent {
  id: string;
  space_id: string;
  selected_text: string;
  session_id: string;
  pid: number | null;
  status: 'running' | 'waiting-approval' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface AgentSession {
  id: string;
  session_id: string;
  space_id: string | null;
  prompt: string;
  status: 'running' | 'waiting-approval' | 'completed' | 'failed';
  summary: string;
  working_dir: string | null;
  source: 'sdk' | 'cli' | 'cca';
  persona_handle: string | null;
  quoted_text: string | null;
  /**
   * Where the agent's runtime executes.  `'local'` is the default and
   * indicates a session whose worker dies when this app process exits.
   * `'cloud'` indicates a session whose worker continues to run remotely
   * (via the SDK's cloud session option, e.g. an @cloud persona); these
   * sessions can be resumed across app restarts and surfaced in Mission
   * Control.
   */
  run_location: 'local' | 'cloud';
  created_at: string;
  updated_at: string;
}

/**
 * Persisted chat event for an agent.  Captured from the SDK session's
 * catch-all event stream during the agent's lifetime so the host can
 * reconstruct a full conversation transcript even if the SDK session is
 * lost (e.g. cloud worker expired, app restarted, runtime resumed without
 * the on-disk event log).
 *
 * When `resumeAgentSession` cannot reattach to the original session, the
 * persisted events are used to build a system-message replay that gets
 * fed into a fresh local session so the user can continue the
 * conversation seamlessly.  See `replayChatIntoFreshSession` in
 * `src/main/agents/sdk-runner.ts`.
 */
export interface AgentChatEvent {
  /** Monotonic per-agent sequence number; deterministic ordering. */
  seq: number;
  /** SDK event UUID (when available) — used for idempotent dedup on replay. */
  event_id: string | null;
  /**
   * Event type as emitted by the SDK (e.g. `assistant.message`,
   * `user.message`, `tool.execution_complete`, `session.error`).
   */
  type: string;
  /** ISO 8601 timestamp of when the host observed the event. */
  timestamp: string;
  /** Serialized JSON of the event payload (event.data when present). */
  payload: string;
}

export interface AgentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface LinkPreviewMeta {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
}

export interface Space {
  id: string;
  description: string;
  body: string | null;
  raw_text: string | null;
  client: string | null;
  due_at: string | null;
  due_at_utc: string | null;
  recurrence: string | null;
  completed_at: string | null;
  folder: string | null;
  session_id: string | null;
  source_skill_id: string | null;
  attachments: Attachment[];
  status: 'captured' | 'in_progress' | 'done';
  created_at: string;
  updated_at: string;
}

export interface CreateSpaceInput {
  body: string;
}

export interface RecurrenceResult {
  should_recur: boolean;
  reasoning: string;
  next_due: string | null;
  next_due_utc: string | null;
}

export interface RecallMatch {
  space_id: string;
  description: string;
  completed_at: string | null;
  confidence: number;
}

// ── Canvas target (popout window) ───────────────────────

export type CanvasTarget =
  | { kind: 'space'; id: string; title: string }
  | { kind: 'skill'; id: string; title: string }
  | { kind: 'page'; spaceId: string; page: string; title: string };

// ── Skills ──────────────────────────────────────────────

export interface SkillFrontmatter {
  name: string;
  description: string;
  [key: string]: unknown;
}

export type SkillScheduleFrequency = 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly';

export interface Skill {
  /** Folder name inside .agents/skills/ (e.g. "pdf-processing") — used as primary key */
  id: string;
  name: string;
  description: string;
  /** Auto-generated or user-specified emoji for visual distinction */
  emoji: string;
  /** Relative folder path from workspace root (e.g. ".agents/skills/pdf-processing") */
  folder: string;
  /** Absolute path to the SKILL.md file */
  filePath: string;
  /** Schedule frequency (null = not scheduled) */
  schedule: SkillScheduleFrequency | null;
  /** Time of day to run in HH:MM format (local time, defaults to "09:00") */
  schedule_time: string | null;
  /** Day of week for weekly/biweekly (0=Sun, 1=Mon, ..., 6=Sat) */
  schedule_day: number | null;
  /** Next scheduled run time in UTC ISO 8601 */
  next_run_at: string | null;
  /** Last time this skill was auto-triggered in UTC ISO 8601 */
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillContent {
  frontmatter: SkillFrontmatter;
  body: string;
}
