/**
 * Goals store tests (Phase B.1).
 *
 * Mocks `window.whimAPI` so we can exercise CRUD + association methods
 * without spinning up Electron.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { goalsStore } from './goals-store';
import type { Goal, Category } from '../../shared/goal-category-types';

function makeGoal(id: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id,
    title: `Goal ${id}`,
    description: null,
    color: '#6E7681',
    sort_order: 0,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCategory(id: string, overrides: Partial<Category> = {}): Category {
  return {
    id,
    title: `Cat ${id}`,
    description: null,
    color: '#6E7681',
    sort_order: 0,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const api = {
  listGoals: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  archiveGoal: vi.fn(),
  unarchiveGoal: vi.fn(),
  deleteGoal: vi.fn(),
  listCategoriesForGoal: vi.fn(),
  associateGoalCategory: vi.fn(),
  disassociateGoalCategory: vi.fn(),
};

beforeEach(() => {
  goalsStore._resetForTests();
  for (const fn of Object.values(api)) fn.mockReset();
  (globalThis as any).window = { whimAPI: api };
});

describe('goalsStore', () => {
  it('loadInitial populates the cache and notifies subscribers', async () => {
    api.listGoals.mockResolvedValue([makeGoal('a'), makeGoal('b')]);
    const seen: number[] = [];
    goalsStore.subscribe(() => seen.push(goalsStore.getState().goals.length));
    await goalsStore.loadInitial();
    expect(goalsStore.getState().goals.map(g => g.id)).toEqual(['a', 'b']);
    expect(goalsStore.getState().loaded).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it('create appends to the cache and dedupes by id', async () => {
    const g = makeGoal('new');
    api.createGoal.mockResolvedValue(g);
    const r1 = await goalsStore.create({ title: 'Goal new' });
    expect(r1?.id).toBe('new');
    expect(goalsStore.getState().goals).toHaveLength(1);
    // Re-create with same id (e.g. raced push event already inserted it).
    api.createGoal.mockResolvedValue(g);
    await goalsStore.create({ title: 'Goal new' });
    expect(goalsStore.getState().goals).toHaveLength(1);
  });

  it('create returns null on error response', async () => {
    api.createGoal.mockResolvedValue({ error: 'title_required' });
    const r = await goalsStore.create({ title: '' });
    expect(r).toBeNull();
    expect(goalsStore.getState().goals).toHaveLength(0);
  });

  it('archive removes the row from active list', async () => {
    api.listGoals.mockResolvedValue([makeGoal('a'), makeGoal('b')]);
    await goalsStore.loadInitial();
    api.archiveGoal.mockResolvedValue({ ok: true });
    await goalsStore.archive('a');
    expect(goalsStore.getState().goals.map(g => g.id)).toEqual(['b']);
  });

  it('archive keeps the row visible (with archived_at set) when includeArchived', async () => {
    api.listGoals.mockResolvedValue([
      makeGoal('a'),
      makeGoal('b', { archived_at: new Date().toISOString() }),
    ]);
    await goalsStore.loadInitial({ includeArchived: true });
    api.archiveGoal.mockResolvedValue({ ok: true });
    await goalsStore.archive('a');
    const goals = goalsStore.getState().goals;
    expect(goals).toHaveLength(2);
    expect(goals.find(g => g.id === 'a')?.archived_at).toBeTruthy();
  });

  it('unarchive clears archived_at on the cached row', async () => {
    api.listGoals.mockResolvedValue([
      makeGoal('a', { archived_at: '2020-01-01T00:00:00Z' }),
    ]);
    await goalsStore.loadInitial({ includeArchived: true });
    api.unarchiveGoal.mockResolvedValue({ ok: true });
    await goalsStore.unarchive('a');
    expect(goalsStore.getState().goals[0].archived_at).toBeNull();
  });

  it('delete drops the row and its category cache', async () => {
    api.listGoals.mockResolvedValue([makeGoal('a')]);
    await goalsStore.loadInitial();
    api.listCategoriesForGoal.mockResolvedValue([makeCategory('c1')]);
    await goalsStore.loadCategoriesFor('a');
    expect(goalsStore.getCategoriesFor('a')).toHaveLength(1);
    api.deleteGoal.mockResolvedValue({ ok: true });
    await goalsStore.delete('a');
    expect(goalsStore.getState().goals).toHaveLength(0);
    expect(goalsStore.getCategoriesFor('a')).toBeUndefined();
  });

  it('association round-trip refreshes the per-goal category list', async () => {
    api.listGoals.mockResolvedValue([makeGoal('g')]);
    await goalsStore.loadInitial();

    api.associateGoalCategory.mockResolvedValue({ ok: true });
    api.listCategoriesForGoal.mockResolvedValueOnce([makeCategory('c1')]);
    const okAdd = await goalsStore.associateCategory('g', 'c1');
    expect(okAdd).toBe(true);
    expect(goalsStore.getCategoriesFor('g')?.map(c => c.id)).toEqual(['c1']);

    api.disassociateGoalCategory.mockResolvedValue({ ok: true });
    api.listCategoriesForGoal.mockResolvedValueOnce([]);
    const okRemove = await goalsStore.disassociateCategory('g', 'c1');
    expect(okRemove).toBe(true);
    expect(goalsStore.getCategoriesFor('g')).toEqual([]);
  });

  it('update replaces the cached row on success', async () => {
    api.listGoals.mockResolvedValue([makeGoal('a', { title: 'old' })]);
    await goalsStore.loadInitial();
    api.updateGoal.mockResolvedValue(makeGoal('a', { title: 'new' }));
    await goalsStore.update('a', { title: 'new' });
    expect(goalsStore.getState().goals[0].title).toBe('new');
  });
});
