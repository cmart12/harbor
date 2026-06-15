/**
 * Categories IPC handlers (Phase B.1).
 *
 * Mirrors `goals-handlers.ts`. Every mutation broadcasts
 * `categories:changed` so the renderer cache refreshes. Archiving a
 * category does NOT cascade to `goal_categories` — the link table
 * survives so unarchiving restores associations. Hard `category:delete`
 * cascades via the FK in `notif-db.ts`.
 */

import { registerHandler, sendToAllWindows } from './typed-handler';
import {
  listCategories,
  createCategory,
  getCategory,
  updateCategory,
  archiveCategory,
  unarchiveCategory,
  deleteCategory,
} from '../notif-db';

function emitChanged(): void {
  sendToAllWindows('categories:changed');
  // A hard category:delete cascades through goal_categories, which
  // changes which categories each goal lists. Emit goals:changed too
  // so the Goals tab refreshes its chip rows.
  sendToAllWindows('goals:changed');
}

export function registerCategoriesHandlers(): void {
  registerHandler('category:list', (_event, filter) => {
    return listCategories(filter ?? {});
  });

  registerHandler('category:create', (_event, input) => {
    if (!input || typeof input.title !== 'string' || input.title.trim() === '') {
      return { error: 'title_required' };
    }
    try {
      const cat = createCategory({
        title: input.title.trim(),
        description: input.description ?? null,
        color: input.color,
        sort_order: input.sort_order,
      });
      emitChanged();
      return cat;
    } catch (err) {
      console.error('[category:create] failed:', err);
      return { error: 'create_failed' };
    }
  });

  registerHandler('category:update', (_event, id, patch) => {
    if (!getCategory(id)) return { error: 'category_not_found' };
    if (patch.title !== undefined && patch.title.trim() === '') {
      return { error: 'title_required' };
    }
    try {
      const next = updateCategory(id, {
        ...patch,
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      });
      if (!next) return { error: 'category_not_found' };
      emitChanged();
      return next;
    } catch (err) {
      console.error('[category:update] failed:', err);
      return { error: 'update_failed' };
    }
  });

  registerHandler('category:archive', (_event, id) => {
    if (!getCategory(id)) return { error: 'category_not_found' };
    const ok = archiveCategory(id);
    if (!ok) return { error: 'archive_failed' };
    emitChanged();
    return { ok: true as const };
  });

  registerHandler('category:unarchive', (_event, id) => {
    if (!getCategory(id)) return { error: 'category_not_found' };
    const ok = unarchiveCategory(id);
    if (!ok) return { error: 'unarchive_failed' };
    emitChanged();
    return { ok: true as const };
  });

  registerHandler('category:delete', (_event, id) => {
    if (!getCategory(id)) return { error: 'category_not_found' };
    const ok = deleteCategory(id);
    if (!ok) return { error: 'delete_failed' };
    emitChanged();
    return { ok: true as const };
  });
}
