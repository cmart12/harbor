/**
 * To-do store (Phase E.1) -- renderer cache for the To-Dos view.
 *
 * Follows the same subscribe/notify pattern as `categories-store.ts`.
 * Subscribes to the `todos:changed` push event so the list auto-refreshes
 * after any mutation from any window.
 */

import type {
  Todo,
  CreateTodoInput,
  UpdateTodoPatch,
  ListTodosFilter,
} from '../../shared/todo-types';
import type { SnoozePreset } from '../../shared/notification-types';
import { getAPI } from '../ipc-client';

type Listener = () => void;

export interface TodosState {
  todos: Todo[];
  filter: ListTodosFilter;
  loaded: boolean;
  loading: boolean;
}

function isOk<T extends { ok: true }>(v: unknown): v is T {
  return !!v && typeof v === 'object' && 'ok' in (v as object) && (v as { ok: unknown }).ok === true;
}

function isError(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

class TodoStore {
  private state: TodosState = {
    todos: [],
    filter: {},
    loaded: false,
    loading: false,
  };
  private listeners: Set<Listener> = new Set();
  private unsubPush: (() => void) | null = null;

  getState(): Readonly<TodosState> {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // Wire up the push event on first subscriber
    if (!this.unsubPush) {
      try {
        const api = getAPI();
        this.unsubPush = api.onTodosChanged(() => {
          void this.refresh();
        });
      } catch {
        // getAPI() may not be available in tests
      }
    }
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  async loadInitial(filter: ListTodosFilter = {}): Promise<void> {
    if (this.state.loading) return;
    this.state = { ...this.state, loading: true, filter };
    this.notify();
    try {
      const api = getAPI();
      const list = (await api.listTodos(filter)) as Todo[];
      this.state = { ...this.state, todos: list, loaded: true, loading: false };
    } catch (err) {
      console.warn('[todo-store] loadInitial failed:', err);
      this.state = { ...this.state, loading: false };
    }
    this.notify();
  }

  async refresh(): Promise<void> {
    this.state = { ...this.state, loaded: false, loading: false };
    await this.loadInitial(this.state.filter);
  }

  async create(input: CreateTodoInput): Promise<Todo | null> {
    const api = getAPI();
    const res = await api.createTodo(input);
    if (isError(res)) return null;
    const todo = res as Todo;
    // Optimistic: prepend to list
    this.state = { ...this.state, todos: [todo, ...this.state.todos] };
    this.notify();
    return todo;
  }

  async update(id: string, patch: UpdateTodoPatch): Promise<Todo | null> {
    const api = getAPI();
    const res = await api.updateTodo({ id, patch });
    if (isError(res)) return null;
    const todo = res as Todo;
    const next = this.state.todos.map(t => (t.id === id ? todo : t));
    this.state = { ...this.state, todos: next };
    this.notify();
    return todo;
  }

  async markDone(id: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.markTodoDone(id);
    if (!isOk(res)) return false;
    // Optimistic: remove from list (default filter excludes done)
    this.state = {
      ...this.state,
      todos: this.state.todos.filter(t => t.id !== id),
    };
    this.notify();
    return true;
  }

  async dismiss(id: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.dismissTodo(id);
    if (!isOk(res)) return false;
    this.state = {
      ...this.state,
      todos: this.state.todos.filter(t => t.id !== id),
    };
    this.notify();
    return true;
  }

  async snooze(id: string, preset: SnoozePreset): Promise<boolean> {
    const api = getAPI();
    const res = await api.snoozeTodo({ id, preset });
    if (!isOk(res)) return false;
    this.state = {
      ...this.state,
      todos: this.state.todos.filter(t => t.id !== id),
    };
    this.notify();
    return true;
  }

  async acceptSuggested(id: string): Promise<boolean> {
    const api = getAPI();
    const res = await api.acceptSuggestedTodo(id);
    if (!isOk(res)) return false;
    const next = this.state.todos.map(t =>
      t.id === id ? { ...t, triage_state: 'triaged' as const } : t,
    );
    this.state = { ...this.state, todos: next };
    this.notify();
    return true;
  }

  async promoteToSpace(id: string): Promise<string | null> {
    const api = getAPI();
    const res = await api.promoteTodoToSpace(id);
    if (isError(res)) return null;
    const result = res as { space_id: string };
    // Update optimistically
    const next = this.state.todos.map(t =>
      t.id === id ? { ...t, space_id: result.space_id } : t,
    );
    this.state = { ...this.state, todos: next };
    this.notify();
    return result.space_id;
  }

  _resetForTests(): void {
    if (this.unsubPush) {
      this.unsubPush();
      this.unsubPush = null;
    }
    this.state = {
      todos: [],
      filter: {},
      loaded: false,
      loading: false,
    };
    this.listeners.clear();
  }
}

export const todoStore = new TodoStore();
