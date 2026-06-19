/**
 * Todo DB tests (Phase E.1).
 *
 * Uses better-sqlite3 in-memory (':memory:') to avoid touching the user's
 * real notifications.db.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  openNotifDb,
  closeNotifDb,
  _resetForTests,
  createTodo,
  getTodo,
  listTodos,
  updateTodo,
  markTodoDone,
  dismissTodo,
  snoozeTodo,
  unsnoozeIfDue,
  acceptSuggestedTodo,
  attachSpaceToTodo,
  createCurationRun,
  getCurationRun,
  updateCurationRun,
  listCurationRuns,
} from './notif-db';
import type { CreateTodoInput } from '../shared/todo-types';

function sample(overrides: Partial<CreateTodoInput> = {}): CreateTodoInput {
  return { title: 'Test todo', ...overrides };
}

describe('todo-db', () => {
  beforeEach(() => {
    _resetForTests();
    openNotifDb(':memory:');
  });

  afterEach(() => {
    closeNotifDb();
    _resetForTests();
  });

  // ── CRUD round-trip ──────────────────────────────────────

  it('creates a todo and reads it back', () => {
    const todo = createTodo(sample());
    expect(todo).toBeDefined();
    expect(todo.id).toBeTruthy();
    expect(todo.title).toBe('Test todo');
    expect(todo.status).toBe('open');
    expect(todo.priority).toBe('whenever');
    expect(todo.source).toBe('manual');
    expect(todo.kind).toBe('task');
    expect(todo.triage_state).toBe('triaged');

    const fetched = getTodo(todo.id);
    expect(fetched).toEqual(todo);
  });

  it('creates a todo with all optional fields', () => {
    const todo = createTodo(sample({
      description: 'A description',
      priority: 'urgent',
      due_at: '2026-12-01T09:00:00Z',
      goal_id: 'goal-1',
      category_id: 'cat-1',
      kind: 'meeting_prep',
      source: 'curation',
      curation_run_id: 'run-1',
      evidence_uids: ['uid-a', 'uid-b'],
      linked_meeting_id: 'meeting-1',
      triage_state: 'suggested',
    }));
    expect(todo.description).toBe('A description');
    expect(todo.priority).toBe('urgent');
    expect(todo.due_at).toBe('2026-12-01T09:00:00Z');
    expect(todo.goal_id).toBe('goal-1');
    expect(todo.category_id).toBe('cat-1');
    expect(todo.kind).toBe('meeting_prep');
    expect(todo.source).toBe('curation');
    expect(todo.curation_run_id).toBe('run-1');
    expect(todo.evidence_uids).toBe(JSON.stringify(['uid-a', 'uid-b']));
    expect(todo.linked_meeting_id).toBe('meeting-1');
    expect(todo.triage_state).toBe('suggested');
  });

  it('getTodo returns null for non-existent id', () => {
    expect(getTodo('no-such-id')).toBeNull();
  });

  it('updateTodo patches fields and bumps updated_at', () => {
    const todo = createTodo(sample());
    const updated = updateTodo(todo.id, { title: 'New title', priority: 'today' });
    expect(updated.title).toBe('New title');
    expect(updated.priority).toBe('today');
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(todo.updated_at).getTime(),
    );
  });

  it('markTodoDone sets status and completed_at', () => {
    const todo = createTodo(sample());
    markTodoDone(todo.id);
    const done = getTodo(todo.id)!;
    expect(done.status).toBe('done');
    expect(done.completed_at).toBeTruthy();
  });

  it('dismissTodo sets status=dismissed and completed_at', () => {
    const todo = createTodo(sample());
    dismissTodo(todo.id);
    const dismissed = getTodo(todo.id)!;
    expect(dismissed.status).toBe('dismissed');
    expect(dismissed.completed_at).toBeTruthy();
  });

  // ── listTodos default filter ─────────────────────────────

  it('default list excludes done and dismissed', () => {
    createTodo(sample({ title: 'active' }));
    const doneT = createTodo(sample({ title: 'done-item' }));
    markTodoDone(doneT.id);
    const dismissedT = createTodo(sample({ title: 'dismissed-item' }));
    dismissTodo(dismissedT.id);

    const list = listTodos();
    expect(list.map(t => t.title)).toEqual(['active']);
  });

  it('default list hides future-snoozed items', () => {
    const todo = createTodo(sample({ title: 'snoozeable' }));
    // Manually snooze to a future time
    snoozeTodo(todo.id, '3h');
    const fetched = getTodo(todo.id)!;
    expect(fetched.status).toBe('snoozed');
    expect(fetched.snoozed_until).toBeTruthy();

    const list = listTodos();
    expect(list.map(t => t.title)).not.toContain('snoozeable');
  });

  it('includeSnoozed=true shows future-snoozed items', () => {
    const todo = createTodo(sample({ title: 'snoozeable' }));
    snoozeTodo(todo.id, '3h');

    const list = listTodos({ includeSnoozed: true });
    expect(list.map(t => t.title)).toContain('snoozeable');
  });

  it('filters by status array', () => {
    createTodo(sample({ title: 'open-item' }));
    const doneT = createTodo(sample({ title: 'done-item' }));
    markTodoDone(doneT.id);

    const list = listTodos({ status: ['done'] });
    expect(list.map(t => t.title)).toEqual(['done-item']);
  });

  it('filters by category_id', () => {
    createTodo(sample({ title: 'cat-a', category_id: 'cat-a' }));
    createTodo(sample({ title: 'cat-b', category_id: 'cat-b' }));

    const list = listTodos({ category_id: 'cat-a' });
    expect(list.map(t => t.title)).toEqual(['cat-a']);
  });

  it('filters by goal_id', () => {
    createTodo(sample({ title: 'goal-x', goal_id: 'goal-x' }));
    createTodo(sample({ title: 'no-goal' }));

    const list = listTodos({ goal_id: 'goal-x' });
    expect(list.map(t => t.title)).toEqual(['goal-x']);
  });

  it('filters by triage_state', () => {
    createTodo(sample({ title: 'triaged-item' }));
    createTodo(sample({ title: 'suggested-item', triage_state: 'suggested' }));

    const list = listTodos({ triage_state: 'suggested' });
    expect(list.map(t => t.title)).toEqual(['suggested-item']);
  });

  it('sorts by priority then due_at then created_at', () => {
    createTodo(sample({ title: 'whenever-item', priority: 'whenever' }));
    createTodo(sample({ title: 'urgent-item', priority: 'urgent' }));
    createTodo(sample({ title: 'today-item', priority: 'today' }));
    createTodo(sample({ title: 'this-week-item', priority: 'this_week' }));

    const list = listTodos();
    expect(list.map(t => t.title)).toEqual([
      'urgent-item',
      'today-item',
      'this-week-item',
      'whenever-item',
    ]);
  });

  // ── Snooze preset math ───────────────────────────────────

  it('snoozeTodo(1h) sets snoozed_until ~1 hour from now', () => {
    const todo = createTodo(sample());
    snoozeTodo(todo.id, '1h');
    const snoozed = getTodo(todo.id)!;
    expect(snoozed.status).toBe('snoozed');
    const until = new Date(snoozed.snoozed_until!).getTime();
    const expected = Date.now() + 60 * 60 * 1000;
    expect(Math.abs(until - expected)).toBeLessThan(5000); // within 5s
  });

  it('snoozeTodo(3h) sets snoozed_until ~3 hours from now', () => {
    const todo = createTodo(sample());
    snoozeTodo(todo.id, '3h');
    const snoozed = getTodo(todo.id)!;
    const until = new Date(snoozed.snoozed_until!).getTime();
    const expected = Date.now() + 3 * 60 * 60 * 1000;
    expect(Math.abs(until - expected)).toBeLessThan(5000);
  });

  it('snoozeTodo(tomorrow_9am) sets snoozed_until to 9:00 AM tomorrow', () => {
    const todo = createTodo(sample());
    snoozeTodo(todo.id, 'tomorrow_9am');
    const snoozed = getTodo(todo.id)!;
    const until = new Date(snoozed.snoozed_until!);
    expect(until.getHours()).toBe(9);
    expect(until.getMinutes()).toBe(0);
    // Must be at least ~12h from now (could be up to ~36h depending on local time)
    expect(until.getTime()).toBeGreaterThan(Date.now());
  });

  it('snoozeTodo(next_monday_9am) sets snoozed_until to next Monday 9:00 AM', () => {
    const todo = createTodo(sample());
    snoozeTodo(todo.id, 'next_monday_9am');
    const snoozed = getTodo(todo.id)!;
    const until = new Date(snoozed.snoozed_until!);
    expect(until.getDay()).toBe(1); // Monday
    expect(until.getHours()).toBe(9);
    expect(until.getMinutes()).toBe(0);
    expect(until.getTime()).toBeGreaterThan(Date.now());
  });

  // ── Unsnooze sweeper ─────────────────────────────────────

  it('unsnoozeIfDue returns 0 when all snoozed items are in the future', () => {
    const todo = createTodo(sample());
    snoozeTodo(todo.id, '3h');
    // All snoozed items are future-dated, so nothing flips
    const changed = unsnoozeIfDue();
    expect(changed).toBe(0);
    // The item remains snoozed
    expect(getTodo(todo.id)!.status).toBe('snoozed');
  });

  // ── Accept suggested ─────────────────────────────────────

  it('acceptSuggestedTodo transitions triage_state from suggested to triaged', () => {
    const todo = createTodo(sample({ triage_state: 'suggested' }));
    expect(todo.triage_state).toBe('suggested');

    acceptSuggestedTodo(todo.id);
    const accepted = getTodo(todo.id)!;
    expect(accepted.triage_state).toBe('triaged');
  });

  it('acceptSuggestedTodo is a no-op on already-triaged todo', () => {
    const todo = createTodo(sample());
    expect(todo.triage_state).toBe('triaged');

    acceptSuggestedTodo(todo.id);
    const same = getTodo(todo.id)!;
    expect(same.triage_state).toBe('triaged');
  });

  // ── attachSpaceToTodo ────────────────────────────────────

  it('attachSpaceToTodo sets space_id', () => {
    const todo = createTodo(sample());
    expect(todo.space_id).toBeNull();

    attachSpaceToTodo(todo.id, 'space-123');
    const updated = getTodo(todo.id)!;
    expect(updated.space_id).toBe('space-123');
  });

  // ── Curation run CRUD ────────────────────────────────────

  it('creates and reads back a curation run', () => {
    const run = createCurationRun({
      run_type: 'morning',
      started_at: new Date().toISOString(),
    });
    expect(run.id).toBeTruthy();
    expect(run.run_type).toBe('morning');
    expect(run.status).toBe('pending');

    const fetched = getCurationRun(run.id);
    expect(fetched).toEqual(run);
  });

  it('updates a curation run', () => {
    const run = createCurationRun({
      run_type: 'evening',
      started_at: new Date().toISOString(),
    });
    const updated = updateCurationRun(run.id, {
      status: 'complete',
      completed_at: new Date().toISOString(),
      todos_created: 5,
    });
    expect(updated.status).toBe('complete');
    expect(updated.todos_created).toBe(5);
  });

  it('listCurationRuns returns runs in descending started_at order', () => {
    createCurationRun({
      run_type: 'morning',
      started_at: '2026-01-01T06:00:00Z',
    });
    createCurationRun({
      run_type: 'evening',
      started_at: '2026-01-01T18:00:00Z',
    });

    const runs = listCurationRuns({ limit: 10 });
    expect(runs).toHaveLength(2);
    expect(runs[0].run_type).toBe('evening'); // more recent first
  });

  it('listCurationRuns respects limit', () => {
    for (let i = 0; i < 5; i++) {
      createCurationRun({
        run_type: 'morning',
        started_at: new Date(Date.now() + i * 1000).toISOString(),
      });
    }
    expect(listCurationRuns({ limit: 3 })).toHaveLength(3);
  });
});
