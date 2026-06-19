/**
 * To-do IPC handlers (Phase E.1).
 *
 * Every mutation broadcasts `todos:changed` so the renderer cache
 * refreshes. `promote-to-space` creates a new Space via the existing
 * `createSpace` function and links it to the to-do via
 * `attachSpaceToTodo`.
 */

import { registerHandler, sendToAllWindows } from './typed-handler';
import {
  listTodos,
  createTodo,
  getTodo,
  updateTodo,
  markTodoDone,
  dismissTodo,
  snoozeTodo,
  acceptSuggestedTodo,
  attachSpaceToTodo,
} from '../notif-db';
import { createSpace, isInitialized } from '../database';
import { getConfigValue } from '../config';
import { materializeSpaceCanvas, scheduleAutoCommit } from '../workspace';

function emitChanged(): void {
  sendToAllWindows('todos:changed');
}

export function registerTodoHandlers(): void {
  registerHandler('todo:list', (_event, filter) => {
    return listTodos(filter ?? {});
  });

  registerHandler('todo:create', (_event, input) => {
    if (!input || typeof input.title !== 'string' || input.title.trim() === '') {
      return { error: 'title_required' };
    }
    try {
      const todo = createTodo({
        ...input,
        title: input.title.trim(),
      });
      emitChanged();
      return todo;
    } catch (err) {
      console.error('[todo:create] failed:', err);
      return { error: 'create_failed' };
    }
  });

  registerHandler('todo:get', (_event, id) => {
    return getTodo(id);
  });

  registerHandler('todo:update', (_event, params) => {
    if (!params || !params.id) return { error: 'id_required' };
    const existing = getTodo(params.id);
    if (!existing) return { error: 'todo_not_found' };

    if (params.patch.title !== undefined && params.patch.title.trim() === '') {
      return { error: 'title_required' };
    }
    try {
      const updated = updateTodo(params.id, {
        ...params.patch,
        ...(params.patch.title !== undefined ? { title: params.patch.title.trim() } : {}),
      });
      emitChanged();
      return updated;
    } catch (err) {
      console.error('[todo:update] failed:', err);
      return { error: 'update_failed' };
    }
  });

  registerHandler('todo:done', (_event, id) => {
    if (!getTodo(id)) return { error: 'todo_not_found' };
    try {
      markTodoDone(id);
      emitChanged();
      return { ok: true as const };
    } catch (err) {
      console.error('[todo:done] failed:', err);
      return { error: 'done_failed' };
    }
  });

  registerHandler('todo:dismiss', (_event, id) => {
    if (!getTodo(id)) return { error: 'todo_not_found' };
    try {
      dismissTodo(id);
      emitChanged();
      return { ok: true as const };
    } catch (err) {
      console.error('[todo:dismiss] failed:', err);
      return { error: 'dismiss_failed' };
    }
  });

  registerHandler('todo:snooze', (_event, params) => {
    if (!params || !params.id) return { error: 'id_required' };
    if (!getTodo(params.id)) return { error: 'todo_not_found' };
    try {
      snoozeTodo(params.id, params.preset);
      emitChanged();
      return { ok: true as const };
    } catch (err) {
      console.error('[todo:snooze] failed:', err);
      return { error: 'snooze_failed' };
    }
  });

  registerHandler('todo:accept-suggested', (_event, id) => {
    const todo = getTodo(id);
    if (!todo) return { error: 'todo_not_found' };
    if (todo.triage_state !== 'suggested') return { error: 'not_suggested' };
    try {
      acceptSuggestedTodo(id);
      emitChanged();
      return { ok: true as const };
    } catch (err) {
      console.error('[todo:accept-suggested] failed:', err);
      return { error: 'accept_failed' };
    }
  });

  registerHandler('todo:promote-to-space', (_event, id) => {
    const todo = getTodo(id);
    if (!todo) return { error: 'todo_not_found' };
    if (!isInitialized()) return { error: 'no_workspace' };

    const body = `# ${todo.title}\n\n${todo.description ?? ''}`.trim();

    let space;
    try {
      space = createSpace({ body });
    } catch (err) {
      console.error('[todo:promote-to-space] createSpace failed:', err);
      return { error: 'create_space_failed' };
    }

    const workspace = getConfigValue('workspace');
    if (workspace && space.folder) {
      const folder = space.folder;
      void materializeSpaceCanvas(workspace, folder, space.body)
        .then(() => scheduleAutoCommit(workspace))
        .catch((e) => console.error('[todo:promote-to-space] canvas materialize failed:', e));
    }

    try {
      attachSpaceToTodo(id, space.id);
    } catch (err) {
      console.warn('[todo:promote-to-space] attachSpaceToTodo failed:', err);
    }

    emitChanged();
    return { space_id: space.id };
  });
}
