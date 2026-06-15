/**
 * Categories store tests (Phase B.1).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { categoriesStore } from './categories-store';
import type { Category } from '../../shared/goal-category-types';

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
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  archiveCategory: vi.fn(),
  unarchiveCategory: vi.fn(),
  deleteCategory: vi.fn(),
};

beforeEach(() => {
  categoriesStore._resetForTests();
  for (const fn of Object.values(api)) fn.mockReset();
  (globalThis as any).window = { whimAPI: api };
});

describe('categoriesStore', () => {
  it('loadInitial populates the cache and notifies subscribers', async () => {
    api.listCategories.mockResolvedValue([makeCategory('a'), makeCategory('b')]);
    const seen: number[] = [];
    categoriesStore.subscribe(() => seen.push(categoriesStore.getState().categories.length));
    await categoriesStore.loadInitial();
    expect(categoriesStore.getState().categories.map(c => c.id)).toEqual(['a', 'b']);
    expect(categoriesStore.getState().loaded).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it('create dedupes by id', async () => {
    const c = makeCategory('new');
    api.createCategory.mockResolvedValue(c);
    await categoriesStore.create({ title: 'Cat new' });
    api.createCategory.mockResolvedValue(c);
    await categoriesStore.create({ title: 'Cat new' });
    expect(categoriesStore.getState().categories).toHaveLength(1);
  });

  it('create returns null on error', async () => {
    api.createCategory.mockResolvedValue({ error: 'title_required' });
    const r = await categoriesStore.create({ title: '' });
    expect(r).toBeNull();
    expect(categoriesStore.getState().categories).toHaveLength(0);
  });

  it('archive removes the row from active list', async () => {
    api.listCategories.mockResolvedValue([makeCategory('a'), makeCategory('b')]);
    await categoriesStore.loadInitial();
    api.archiveCategory.mockResolvedValue({ ok: true });
    await categoriesStore.archive('a');
    expect(categoriesStore.getState().categories.map(c => c.id)).toEqual(['b']);
  });

  it('archive keeps the row visible when includeArchived', async () => {
    api.listCategories.mockResolvedValue([makeCategory('a')]);
    await categoriesStore.loadInitial({ includeArchived: true });
    api.archiveCategory.mockResolvedValue({ ok: true });
    await categoriesStore.archive('a');
    expect(categoriesStore.getState().categories).toHaveLength(1);
    expect(categoriesStore.getState().categories[0].archived_at).toBeTruthy();
  });

  it('archive then refetch with includeArchived shows the row again', async () => {
    // First: default fetch (active only), archive removes from cache.
    api.listCategories.mockResolvedValue([makeCategory('a')]);
    await categoriesStore.loadInitial();
    api.archiveCategory.mockResolvedValue({ ok: true });
    await categoriesStore.archive('a');
    expect(categoriesStore.getState().categories).toHaveLength(0);

    // Then: refetch with includeArchived returns it from the DB.
    api.listCategories.mockResolvedValue([
      makeCategory('a', { archived_at: new Date().toISOString() }),
    ]);
    await categoriesStore.loadInitial({ includeArchived: true });
    expect(categoriesStore.getState().categories).toHaveLength(1);
  });

  it('unarchive clears archived_at on the cached row', async () => {
    api.listCategories.mockResolvedValue([
      makeCategory('a', { archived_at: '2020-01-01T00:00:00Z' }),
    ]);
    await categoriesStore.loadInitial({ includeArchived: true });
    api.unarchiveCategory.mockResolvedValue({ ok: true });
    await categoriesStore.unarchive('a');
    expect(categoriesStore.getState().categories[0].archived_at).toBeNull();
  });

  it('delete drops the row from the cache', async () => {
    api.listCategories.mockResolvedValue([makeCategory('a')]);
    await categoriesStore.loadInitial();
    api.deleteCategory.mockResolvedValue({ ok: true });
    await categoriesStore.delete('a');
    expect(categoriesStore.getState().categories).toHaveLength(0);
  });

  it('update replaces the cached row on success', async () => {
    api.listCategories.mockResolvedValue([makeCategory('a', { title: 'old' })]);
    await categoriesStore.loadInitial();
    api.updateCategory.mockResolvedValue(makeCategory('a', { title: 'new' }));
    await categoriesStore.update('a', { title: 'new' });
    expect(categoriesStore.getState().categories[0].title).toBe('new');
  });
});
