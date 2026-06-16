/**
 * Notification IPC handlers (Phase A.2).
 *
 * Thin wrappers around `notif-db.ts` + the snooze math; the heavy lifting
 * lives in those modules. Each handler returns `{ ok: true }` or
 * `{ error: string }` so the renderer can surface failures without us
 * leaking exceptions across the IPC boundary.
 *
 * `promote-to-new-space` is the bridge between the sidecar notif DB and
 * the event-log-backed primary DB: it calls `createSpace` with the new
 * `sourceNotificationId`, then atomically marks the notification
 * `promoted` and records the resulting `space_id` so we can navigate
 * back from the Space to its originating notification later.
 */

import { shell } from 'electron';
import { registerHandler } from './typed-handler';
import {
  listNotifications,
  getNotification,
  updateStatus,
  setPromotedSpace,
  isVipSender,
} from '../notif-db';
import { createSpace, isInitialized } from '../database';
import { computeSnoozeUntil } from '../notif-snooze';
import { getConfigValue } from '../config';
import { materializeSpaceCanvas, scheduleAutoCommit } from '../workspace';

export function registerNotificationHandlers(): void {
  registerHandler('notification:list', (_event, filter) => {
    return listNotifications(filter ?? {}).map(notification => ({
      ...notification,
      is_vip: isVipSender(notification.sender_email ?? ''),
    }));
  });

  registerHandler('notification:promote-to-new-space', (_event, uid) => {
    const notif = getNotification(uid);
    if (!notif) return { error: 'notification_not_found' };
    if (!isInitialized()) return { error: 'no_workspace' };

    // Seed the Space body from the notification subject + body so the
    // canvas opens with usable context. The canvas auto-derives the title
    // from the first H1, so we synthesize one here.
    const subject = notif.subject?.trim() || '(no subject)';
    const bodyText = notif.body?.trim() || '';
    const senderLine = notif.sender_name
      ? `From: ${notif.sender_name}${notif.sender_email ? ` <${notif.sender_email}>` : ''}\n\n`
      : '';
    const sourceLine = `Source: ${notif.source}${notif.app_id ? ` (${notif.app_id})` : ''}\n\n`;
    const body = `# ${subject}\n\n${senderLine}${sourceLine}${bodyText}`.trim();

    let space;
    try {
      space = createSpace({ body, sourceNotificationId: uid });
    } catch (err) {
      console.error('[notification:promote] createSpace failed:', err);
      return { error: 'create_space_failed' };
    }

    // Materialize the canvas folder off the critical path, matching
    // `space-handlers.ts:space:create`.
    const workspace = getConfigValue('workspace');
    if (workspace && space.folder) {
      const folder = space.folder;
      void materializeSpaceCanvas(workspace, folder, space.body)
        .then(() => scheduleAutoCommit(workspace))
        .catch((e) => console.error('[notification:promote] canvas materialize failed:', e));
    }

    try {
      setPromotedSpace(uid, space.id);
    } catch (err) {
      console.warn('[notification:promote] setPromotedSpace failed:', err);
      // Don't fail the whole call — the Space exists; the notification
      // just stayed in its prior status. The user can re-promote.
    }
    return { spaceId: space.id };
  });

  registerHandler('notification:open-link', async (_event, uid) => {
    const notif = getNotification(uid);
    if (!notif) return { error: 'notification_not_found' };
    const link = notif.deep_link?.trim();
    if (!link) return { error: 'no_deep_link' };
    try {
      await shell.openExternal(link);
      return { ok: true as const };
    } catch (err) {
      console.warn('[notification:open-link] failed:', err);
      return { error: 'open_failed' };
    }
  });

  registerHandler('notification:snooze', (_event, uid, preset) => {
    if (!getNotification(uid)) return { error: 'notification_not_found' };
    let snoozedUntil: string;
    try {
      snoozedUntil = computeSnoozeUntil(preset);
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'invalid_preset' };
    }
    const ok = updateStatus(uid, 'snoozed', snoozedUntil);
    return ok ? { ok: true as const, snoozedUntil } : { error: 'update_failed' };
  });

  registerHandler('notification:archive', (_event, uid) => {
    if (!getNotification(uid)) return { error: 'notification_not_found' };
    return updateStatus(uid, 'archived') ? { ok: true as const } : { error: 'update_failed' };
  });

  registerHandler('notification:mark-done', (_event, uid) => {
    if (!getNotification(uid)) return { error: 'notification_not_found' };
    return updateStatus(uid, 'done') ? { ok: true as const } : { error: 'update_failed' };
  });
}
