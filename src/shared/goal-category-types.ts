/**
 * Goal + Category domain types (Phase B.1).
 *
 * Lives in `shared/` because both the main process (sidecar DB + IPC
 * handlers) and the renderer (Settings UI, stores, future Feed filters)
 * consume them.
 *
 * Storage decision: goals, categories, and the goal↔category join table
 * live in the sidecar `notifications.db` alongside notifications. Keeping
 * the Harbor data co-located avoids cross-DB joins later when the Phase
 * B.2 classifier tags notifications with `category_id` / `goal_id`.
 *
 * Lifecycle: both entities are soft-deleted via `archived_at` (UTC
 * RFC3339). Default queries hide archived rows; pass `includeArchived`
 * to surface them.
 */

export const DEFAULT_GOAL_COLOR = '#6E7681';
export const DEFAULT_CATEGORY_COLOR = '#6E7681';

/**
 * Common shape for goals and categories. They share columns; the
 * distinction is purely semantic — a goal is an outcome you're working
 * toward, a category is a recurring topic that groups notifications.
 */
export interface GoalCategoryBase {
  id: string;
  title: string;
  description: string | null;
  /** Hex color `#rrggbb` used for chips/swatches in the UI. */
  color: string;
  /** Manual ordering set by drag-and-drop in B.3; default 0. */
  sort_order: number;
  /** UTC RFC3339; null = active. */
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type Goal = GoalCategoryBase;
export type Category = GoalCategoryBase;

export interface CreateGoalInput {
  title: string;
  description?: string | null;
  color?: string;
  sort_order?: number;
}

export interface CreateCategoryInput {
  title: string;
  description?: string | null;
  color?: string;
  sort_order?: number;
}

/** Patch shape for `goal:update` / `category:update`. All fields optional. */
export type UpdateGoalPatch = Partial<{
  title: string;
  description: string | null;
  color: string;
  sort_order: number;
}>;

export type UpdateCategoryPatch = UpdateGoalPatch;

export interface ListGoalsFilter {
  includeArchived?: boolean;
}

export interface ListCategoriesFilter {
  includeArchived?: boolean;
}
