/**
 * Sidecar goals/categories DB tests (Phase B.1).
 *
 * Mirrors `notif-db.test.ts` setup (in-memory SQLite).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  openNotifDb,
  _resetForTests,
  createGoal,
  listGoals,
  getGoal,
  updateGoal,
  archiveGoal,
  unarchiveGoal,
  deleteGoal,
  createCategory,
  listCategories,
  getCategory,
  updateCategory,
  archiveCategory,
  unarchiveCategory,
  deleteCategory,
  associateGoalCategory,
  disassociateGoalCategory,
  listCategoriesForGoal,
  listGoalsForCategory,
} from './notif-db';
import { DEFAULT_GOAL_COLOR } from '../shared/goal-category-types';

describe('notif-db goals + categories', () => {
  beforeEach(() => {
    _resetForTests();
    openNotifDb(':memory:');
  });

  it('seeds default categories on first open', () => {
    const cats = listCategories();
    // Default seed list contains the 5 brief defaults plus an "Other".
    expect(cats.length).toBeGreaterThanOrEqual(5);
    const titles = cats.map(c => c.title);
    expect(titles).toEqual(
      expect.arrayContaining(['Dual Access', 'SDK Partners', 'AI Workstream']),
    );
  });

  it('createGoal returns the row with default color', () => {
    const g = createGoal({ title: 'Ship Harbor M1' });
    expect(g.title).toBe('Ship Harbor M1');
    expect(g.color).toBe(DEFAULT_GOAL_COLOR);
    expect(g.archived_at).toBeNull();
    expect(getGoal(g.id)?.title).toBe('Ship Harbor M1');
  });

  it('listGoals excludes archived by default, includes when requested', () => {
    const a = createGoal({ title: 'A' });
    const b = createGoal({ title: 'B' });
    archiveGoal(b.id);
    expect(listGoals().map(g => g.id)).toEqual([a.id]);
    const all = listGoals({ includeArchived: true });
    expect(all.map(g => g.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('updateGoal patches only provided fields and bumps updated_at', async () => {
    const g = createGoal({ title: 'A' });
    await new Promise(r => setTimeout(r, 10));
    const updated = updateGoal(g.id, { title: 'A2', color: '#ff0000' });
    expect(updated?.title).toBe('A2');
    expect(updated?.color).toBe('#ff0000');
    expect(updated?.description).toBeNull();
    expect(updated && updated.updated_at >= g.updated_at).toBe(true);
  });

  it('archive/unarchive toggle archived_at', () => {
    const g = createGoal({ title: 'A' });
    expect(archiveGoal(g.id)).toBe(true);
    expect(getGoal(g.id)?.archived_at).not.toBeNull();
    expect(unarchiveGoal(g.id)).toBe(true);
    expect(getGoal(g.id)?.archived_at).toBeNull();
  });

  it('deleteGoal removes the row', () => {
    const g = createGoal({ title: 'A' });
    expect(deleteGoal(g.id)).toBe(true);
    expect(getGoal(g.id)).toBeNull();
  });

  it('createCategory + CRUD lifecycle mirrors goals', () => {
    const c = createCategory({ title: 'Custom', color: '#abcdef' });
    expect(getCategory(c.id)?.color).toBe('#abcdef');
    expect(updateCategory(c.id, { description: 'note' })?.description).toBe('note');
    expect(archiveCategory(c.id)).toBe(true);
    expect(getCategory(c.id)?.archived_at).not.toBeNull();
    expect(unarchiveCategory(c.id)).toBe(true);
    expect(deleteCategory(c.id)).toBe(true);
    expect(getCategory(c.id)).toBeNull();
  });

  it('associate/disassociate goal↔category is idempotent and reverse-lookup works', () => {
    const g = createGoal({ title: 'G' });
    const c = createCategory({ title: 'C' });
    expect(associateGoalCategory(g.id, c.id)).toBe(true);
    // second associate is a no-op (INSERT OR IGNORE).
    expect(associateGoalCategory(g.id, c.id)).toBe(false);
    expect(listCategoriesForGoal(g.id).map(x => x.id)).toEqual([c.id]);
    expect(listGoalsForCategory(c.id).map(x => x.id)).toEqual([g.id]);
    expect(disassociateGoalCategory(g.id, c.id)).toBe(true);
    expect(listCategoriesForGoal(g.id)).toEqual([]);
  });

  it('deleting a goal cascades the join table', () => {
    const g = createGoal({ title: 'G' });
    const c = createCategory({ title: 'C' });
    associateGoalCategory(g.id, c.id);
    deleteGoal(g.id);
    expect(listGoalsForCategory(c.id)).toEqual([]);
  });

  it('deleting a category cascades the join table', () => {
    const g = createGoal({ title: 'G' });
    const c = createCategory({ title: 'C' });
    associateGoalCategory(g.id, c.id);
    deleteCategory(c.id);
    expect(listCategoriesForGoal(g.id)).toEqual([]);
  });

  it('listCategoriesForGoal excludes archived categories by default', () => {
    const g = createGoal({ title: 'G' });
    const c = createCategory({ title: 'C' });
    associateGoalCategory(g.id, c.id);
    archiveCategory(c.id);
    expect(listCategoriesForGoal(g.id)).toEqual([]);
    expect(listCategoriesForGoal(g.id, { includeArchived: true }).map(x => x.id)).toEqual([c.id]);
  });
});
