/**
 * Categories store (Phase B.1) — renderer cache for the Settings → Categories tab.
 *
 * Mirrors `goals-store.ts`. The Categories tab subscribes once on
 * activation and refetches whenever the main process emits
 * `categories:changed` (which happens on category mutations and on
 * goal-association mutations that touch the join table).
 */

import type {
  Category,
  CreateCategoryInput,
  UpdateCategoryPatch,
  ListCategoriesFilter,
} from '../../shared/goal-category-types';
import { getAPI } from '../ipc-client';

type Listener = () => void;

export interface CategoriesState {
  categories: Category[];
  includeArchived: boolean;
  loaded: boolean;
  loading: boolean;
}

function isOk<T extends { ok: true }>(v: unknown): v is T {
  return !!v && typeof v === 'object' && 'ok' in (v as object) && (v as { ok: unknown }).ok === true;
}

function isError(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

class CategoriesStore {
  private state: CategoriesState = {
    categories: [],
    includeArchived: false,
    loaded: false,
    loading: false,
  };
  private listeners: Set<Listener> = new Set();

  getState(): Readonly<CategoriesState> {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  async loadInitial(filter: ListCategoriesFilter = {}): Promise<void> {
    if (this.state.loading) return;
    this.state = {
      ...this.state,
      loading: true,
      includeArchived: !!filter.includeArchived,
    };
    this.notify();
    try {
      const api = getAPI();
      const list = (await api.listCategories(filter)) as Category[];
      this.state = { ...this.state, categories: list, loaded: true, loading: false };
    } catch (err) {
      console.warn('[categories-store] loadInitial failed:', err);
      this.state = { ...this.state, loading: false };
    }
    this.notify();
  }

  async refresh(): Promise<void> {
    this.state = { ...this.state, loading: false, loaded: false };
    await this.loadInitial({ includeArchived: this.state.includeArchived });
  }

  async create(input: CreateCategoryInput): Promise<Category | null> {
    const api = getAPI();
    const res = await api.createCategory(input);
    if (isError(res)) return null;
    const cat = res as Category;
    if (!this.state.categories.some(c => c.id === cat.id)) {
      this.state = { ...this.state, categories: [...this.state.categories, cat] };
      this.notify();
    }
    return cat;
  }

  async update(id: string, patch: UpdateCategoryPatch): Promise<Category | null> {
    const api = getAPI();
    const res = await api.updateCategory(id, patch);
    if (isError(res)) return null;
    const cat = res as Category;
    const next = this.state.categories.map(c => (c.id === id ? cat : c));
    this.state = { ...this.state, categories: next };
    this.notify();
    return cat;
  }

  async archive(id: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.archiveCategory(id);
    if (!isOk(res)) return false;
    if (!this.state.includeArchived) {
      this.state = {
        ...this.state,
        categories: this.state.categories.filter(c => c.id !== id),
      };
    } else {
      const now = new Date().toISOString();
      this.state = {
        ...this.state,
        categories: this.state.categories.map(c =>
          c.id === id ? { ...c, archived_at: now, updated_at: now } : c,
        ),
      };
    }
    this.notify();
    return true;
  }

  async unarchive(id: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.unarchiveCategory(id);
    if (!isOk(res)) return false;
    const now = new Date().toISOString();
    this.state = {
      ...this.state,
      categories: this.state.categories.map(c =>
        c.id === id ? { ...c, archived_at: null, updated_at: now } : c,
      ),
    };
    this.notify();
    return true;
  }

  async delete(id: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.deleteCategory(id);
    if (!isOk(res)) return false;
    this.state = {
      ...this.state,
      categories: this.state.categories.filter(c => c.id !== id),
    };
    this.notify();
    return true;
  }

  _resetForTests(): void {
    this.state = {
      categories: [],
      includeArchived: false,
      loaded: false,
      loading: false,
    };
    this.listeners.clear();
  }
}

export const categoriesStore = new CategoriesStore();
