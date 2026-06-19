/**
 * To-do domain types (Phase E.1).
 *
 * Lives in `shared/` because both the main process (sidecar DB + IPC
 * handlers) and the renderer (To-Do view, store) consume them.
 *
 * Storage: todos and curation_runs live in the sidecar `notifications.db`
 * alongside notifications, goals, and categories. To-dos become the
 * primary object in the Phase E redesign; notifications become the
 * evidence pool that feeds them.
 */

import type { SnoozePreset } from './notification-types';

// ---------------------------------------------------------------------------
// Enums (code-level only, no CHECK constraints in the DB)
// ---------------------------------------------------------------------------

export type TodoStatus = 'open' | 'in_progress' | 'done' | 'dismissed' | 'snoozed';
export type TodoPriority = 'urgent' | 'today' | 'this_week' | 'whenever';
export type TodoSource = 'manual' | 'curation' | 'promoted_notification';
export type TodoKind = 'task' | 'meeting_prep' | 'handoff_note';
export type TodoTriageState = 'triaged' | 'suggested';

export type CurationRunType = 'morning' | 'evening' | 'manual_morning' | 'manual_evening' | 'kickoff';
export type CurationRunStatus = 'pending' | 'running' | 'complete' | 'failed';

// ---------------------------------------------------------------------------
// Domain objects
// ---------------------------------------------------------------------------

export interface Todo {
  id: string;
  title: string;
  description: string | null;
  status: TodoStatus;
  source: TodoSource;
  curation_run_id: string | null;
  /** JSON array of notification source_uids. */
  evidence_uids: string | null;
  goal_id: string | null;
  category_id: string | null;
  priority: TodoPriority;
  due_at: string | null;
  snoozed_until: string | null;
  space_id: string | null;
  kind: TodoKind;
  linked_meeting_id: string | null;
  triage_state: TodoTriageState;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CurationRun {
  id: string;
  run_type: CurationRunType;
  status: CurationRunStatus;
  started_at: string;
  completed_at: string | null;
  source_window_start: string | null;
  source_window_end: string | null;
  summary: string | null;
  todos_created: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Input / patch / filter shapes
// ---------------------------------------------------------------------------

export interface CreateTodoInput {
  title: string;
  description?: string | null;
  priority?: TodoPriority;
  due_at?: string | null;
  goal_id?: string | null;
  category_id?: string | null;
  kind?: TodoKind;
  source?: TodoSource;
  curation_run_id?: string | null;
  evidence_uids?: string[] | null;
  linked_meeting_id?: string | null;
  triage_state?: TodoTriageState;
}

export interface UpdateTodoPatch {
  title?: string;
  description?: string | null;
  status?: TodoStatus;
  priority?: TodoPriority;
  due_at?: string | null;
  goal_id?: string | null;
  category_id?: string | null;
  kind?: TodoKind;
  linked_meeting_id?: string | null;
}

export interface ListTodosFilter {
  status?: TodoStatus[];
  triage_state?: TodoTriageState;
  category_id?: string;
  goal_id?: string;
  includeSnoozed?: boolean;
}

export interface CreateCurationRunInput {
  run_type: CurationRunType;
  started_at?: string;
  source_window_start?: string | null;
  source_window_end?: string | null;
}

export interface UpdateCurationRunPatch {
  status?: CurationRunStatus;
  completed_at?: string | null;
  summary?: string | null;
  todos_created?: number;
  error?: string | null;
}

export { SnoozePreset };
