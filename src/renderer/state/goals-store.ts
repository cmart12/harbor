/**
 * Goals store (Phase B.1) — renderer cache for the Settings → Goals tab.
 *
 * Mirrors the subscribe/notify shape of `feed-store.ts`. The Goals tab
 * subscribes once on activation, re-renders on every change, and refetches
 * whenever the main process emits `goals:changed`.
 *
 * Linked categories per goal are stored in a separate map keyed by goal id
 * so the chip row under each goal can re-render without refetching the
 * full goal list.
 */

import type {
  Goal,
  Category,
  CreateGoalInput,
  UpdateGoalPatch,
  ListGoalsFilter,
} from '../../shared/goal-category-types';
import { getAPI } from '../ipc-client';

type Listener = () => void;

export interface GoalsState {
  goals: Goal[];
  includeArchived: boolean;
  loaded: boolean;
  loading: boolean;
  /** Categories linked to each goal id. Lazily populated. */
  categoriesByGoal: Map<string, Category[]>;
}

function isOk<T extends { ok: true }>(v: unknown): v is T {
  return !!v && typeof v === 'object' && 'ok' in (v as object) && (v as { ok: unknown }).ok === true;
}

function isError(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

class GoalsStore {
  private state: GoalsState = {
    goals: [],
    includeArchived: false,
    loaded: false,
    loading: false,
    categoriesByGoal: new Map(),
  };
  private listeners: Set<Listener> = new Set();

  getState(): Readonly<GoalsState> {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  async loadInitial(filter: ListGoalsFilter = {}): Promise<void> {
    if (this.state.loading) return;
    this.state = {
      ...this.state,
      loading: true,
      includeArchived: !!filter.includeArchived,
    };
    this.notify();
    try {
      const api = getAPI();
      const list = (await api.listGoals(filter)) as Goal[];
      this.state = {
        ...this.state,
        goals: list,
        loaded: true,
        loading: false,
      };
    } catch (err) {
      console.warn('[goals-store] loadInitial failed:', err);
      this.state = { ...this.state, loading: false };
    }
    this.notify();
  }

  /** Force a fresh fetch (e.g. on `goals:changed` push). */
  async refresh(): Promise<void> {
    this.state = { ...this.state, loading: false, loaded: false };
    await this.loadInitial({ includeArchived: this.state.includeArchived });
  }

  async create(input: CreateGoalInput): Promise<Goal | null> {
    const api = getAPI();
    const res = await api.createGoal(input);
    if (isError(res)) return null;
    const goal = res as Goal;
    if (!this.state.goals.some(g => g.id === goal.id)) {
      this.state = { ...this.state, goals: [...this.state.goals, goal] };
      this.notify();
    }
    return goal;
  }

  async update(id: string, patch: UpdateGoalPatch): Promise<Goal | null> {
    const api = getAPI();
    const res = await api.updateGoal(id, patch);
    if (isError(res)) return null;
    const goal = res as Goal;
    const next = this.state.goals.map(g => (g.id === id ? goal : g));
    this.state = { ...this.state, goals: next };
    this.notify();
    return goal;
  }

  async archive(id: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.archiveGoal(id);
    if (!isOk(res)) return false;
    if (!this.state.includeArchived) {
      this.state = { ...this.state, goals: this.state.goals.filter(g => g.id !== id) };
    } else {
      const now = new Date().toISOString();
      this.state = {
        ...this.state,
        goals: this.state.goals.map(g =>
          g.id === id ? { ...g, archived_at: now, updated_at: now } : g,
        ),
      };
    }
    this.notify();
    return true;
  }

  async unarchive(id: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.unarchiveGoal(id);
    if (!isOk(res)) return false;
    const now = new Date().toISOString();
    this.state = {
      ...this.state,
      goals: this.state.goals.map(g =>
        g.id === id ? { ...g, archived_at: null, updated_at: now } : g,
      ),
    };
    this.notify();
    return true;
  }

  async delete(id: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.deleteGoal(id);
    if (!isOk(res)) return false;
    this.state = { ...this.state, goals: this.state.goals.filter(g => g.id !== id) };
    this.state.categoriesByGoal.delete(id);
    this.notify();
    return true;
  }

  async loadCategoriesFor(goalId: string): Promise<Category[]> {
    const api = getAPI();
    const list = (await api.listCategoriesForGoal(goalId)) as Category[];
    const map = new Map(this.state.categoriesByGoal);
    map.set(goalId, list);
    this.state = { ...this.state, categoriesByGoal: map };
    this.notify();
    return list;
  }

  getCategoriesFor(goalId: string): Category[] | undefined {
    return this.state.categoriesByGoal.get(goalId);
  }

  async associateCategory(goalId: string, categoryId: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.associateGoalCategory({ goalId, categoryId });
    if (!isOk(res)) return false;
    await this.loadCategoriesFor(goalId);
    return true;
  }

  async disassociateCategory(goalId: string, categoryId: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.disassociateGoalCategory({ goalId, categoryId });
    if (!isOk(res)) return false;
    await this.loadCategoriesFor(goalId);
    return true;
  }

  _resetForTests(): void {
    this.state = {
      goals: [],
      includeArchived: false,
      loaded: false,
      loading: false,
      categoriesByGoal: new Map(),
    };
    this.listeners.clear();
  }
}

export const goalsStore = new GoalsStore();
