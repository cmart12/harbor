/**
 * Goals IPC handlers (Phase B.1).
 *
 * Thin wrappers around `notif-db.ts` goal helpers. Every mutation
 * broadcasts `goals:changed` so any open renderer (including the
 * Settings UI) refetches. Association mutations also broadcast since
 * the goal row's linked-categories chip list re-renders from the
 * goals store.
 */

import { registerHandler, sendToAllWindows } from './typed-handler';
import {
  listGoals,
  createGoal,
  getGoal,
  updateGoal,
  archiveGoal,
  unarchiveGoal,
  deleteGoal,
  listCategoriesForGoal,
  associateGoalCategory,
  disassociateGoalCategory,
  getCategory,
} from '../notif-db';

function emitChanged(): void {
  sendToAllWindows('goals:changed');
}

export function registerGoalsHandlers(): void {
  registerHandler('goal:list', (_event, filter) => {
    return listGoals(filter ?? {});
  });

  registerHandler('goal:create', (_event, input) => {
    if (!input || typeof input.title !== 'string' || input.title.trim() === '') {
      return { error: 'title_required' };
    }
    try {
      const goal = createGoal({
        title: input.title.trim(),
        description: input.description ?? null,
        color: input.color,
        sort_order: input.sort_order,
      });
      emitChanged();
      return goal;
    } catch (err) {
      console.error('[goal:create] failed:', err);
      return { error: 'create_failed' };
    }
  });

  registerHandler('goal:update', (_event, id, patch) => {
    if (!getGoal(id)) return { error: 'goal_not_found' };
    if (patch.title !== undefined && patch.title.trim() === '') {
      return { error: 'title_required' };
    }
    try {
      const next = updateGoal(id, {
        ...patch,
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      });
      if (!next) return { error: 'goal_not_found' };
      emitChanged();
      return next;
    } catch (err) {
      console.error('[goal:update] failed:', err);
      return { error: 'update_failed' };
    }
  });

  registerHandler('goal:archive', (_event, id) => {
    if (!getGoal(id)) return { error: 'goal_not_found' };
    const ok = archiveGoal(id);
    if (!ok) return { error: 'archive_failed' };
    emitChanged();
    return { ok: true as const };
  });

  registerHandler('goal:unarchive', (_event, id) => {
    if (!getGoal(id)) return { error: 'goal_not_found' };
    const ok = unarchiveGoal(id);
    if (!ok) return { error: 'unarchive_failed' };
    emitChanged();
    return { ok: true as const };
  });

  registerHandler('goal:delete', (_event, id) => {
    if (!getGoal(id)) return { error: 'goal_not_found' };
    const ok = deleteGoal(id);
    if (!ok) return { error: 'delete_failed' };
    emitChanged();
    return { ok: true as const };
  });

  registerHandler('goal:list-categories', (_event, goalId) => {
    return listCategoriesForGoal(goalId);
  });

  registerHandler('goal:associate-category', (_event, params) => {
    if (!getGoal(params.goalId)) return { error: 'goal_not_found' };
    if (!getCategory(params.categoryId)) return { error: 'category_not_found' };
    associateGoalCategory(params.goalId, params.categoryId);
    emitChanged();
    return { ok: true as const };
  });

  registerHandler('goal:disassociate-category', (_event, params) => {
    if (!getGoal(params.goalId)) return { error: 'goal_not_found' };
    disassociateGoalCategory(params.goalId, params.categoryId);
    emitChanged();
    return { ok: true as const };
  });
}
