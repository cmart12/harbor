import { ipcMain } from 'electron';
import { isInitialized, createSpace, listSpaces, updateSpace, deleteSpace, getSpace, logSpaceEvent, listSpaceEvents, searchSpaces } from '../database';
import { parseSpaceWithAI, resolveDateWithAI, classifyInput } from '../ai';
import { CreateSpaceInput, Space } from '../../shared/types';
import { getConfigValue } from '../config';
import { materializeSpaceCanvas, scheduleAutoCommit, commitNow, archiveSpaceFolder, unarchiveSpaceFolder, deleteSpaceFolder } from '../workspace';
import { handleRecurrence, dismissRecurrence, cancelPendingRecurrence } from '../services/recurrence';
import { processSpaceInBackground } from '../services/space-processing';

export function registerSpaceHandlers(): void {
  ipcMain.handle('space:create', (_event, input: CreateSpaceInput) => {
    if (!isInitialized()) return { error: 'no_workspace' };
    // createSpace records the (deterministic) folder name in the single create
    // event, so the IPC can return immediately after the DB write.
    const space = createSpace(input);

    // Materialize the folder + seed the canvas off the critical path. The folder
    // name is already known/persisted; the on-disk write does not block the reply.
    const workspace = getConfigValue('workspace');
    if (workspace && space.folder) {
      const folder = space.folder;
      void materializeSpaceCanvas(workspace, folder, space.body)
        .then(() => scheduleAutoCommit(workspace))
        .catch((err) => console.error('[space:create] Canvas materialization failed:', err));
    }

    processSpaceInBackground(space.id, space.body || space.description, space.updated_at);
    return space;
  });

  ipcMain.handle('space:list', () => {
    if (!isInitialized()) return [];
    return listSpaces();
  });

  ipcMain.handle('space:update', async (_event, id: string, updates: Partial<Pick<Space, 'description' | 'body' | 'client' | 'due_at' | 'due_at_utc' | 'status' | 'attachments'>>) => {
    // Detect transition to 'done' for recurrence evaluation
    if (updates.status === 'done') {
      const current = getSpace(id);
      if (current && current.status !== 'done') {
        // Real transition to done
        const completedAt = new Date().toISOString();
        const updated = updateSpace(id, { ...updates, completed_at: completedAt });
        if (updated) {
          logSpaceEvent(id, 'completed', {
            due_at: updated.due_at,
            due_at_utc: updated.due_at_utc,
            completed_at: completedAt,
          });

          // If this is a dated space, evaluate recurrence
          if (updated.due_at_utc || updated.due_at) {
            handleRecurrence(updated, updated.updated_at);
          }

          // Commit all pending changes, then archive the folder
          const workspace = getConfigValue('workspace');
          if (workspace && updated.folder) {
            await commitNow(workspace);
            archiveSpaceFolder(workspace, updated.folder);
            scheduleAutoCommit(workspace);
          }
        }
        return updated;
      }
    }

    // If body is being set (e.g., from canvas write-then-close), trigger AI refinement
    if (updates.body && updates.body.trim()) {
      const current = getSpace(id);
      if (current && (!current.description || current.description === '' || current.description === current.body)) {
        const updated = updateSpace(id, updates);
        if (updated) {
          processSpaceInBackground(id, updates.body, updated.updated_at);
        }
        return updated;
      }
    }

    return updateSpace(id, updates);
  });

  ipcMain.handle('space:delete', (_event, id: string) => {
    const current = getSpace(id);
    cancelPendingRecurrence(id);
    const result = deleteSpace(id);
    const workspace = getConfigValue('workspace');
    if (workspace) {
      if (current?.folder) {
        deleteSpaceFolder(workspace, current.folder);
      }
      scheduleAutoCommit(workspace);
    }
    return result;
  });

  ipcMain.handle('space:dismiss-recurrence', (_event, id: string) => {
    dismissRecurrence(id);
    return true;
  });

  // Space events / timeline
  ipcMain.handle('space:events', (_event, limit?: number) => {
    return listSpaceEvents(limit || 100);
  });

  // Resolve natural language date
  ipcMain.handle('space:resolve-date', async (_event, dateText: string) => {
    return resolveDateWithAI(dateText);
  });

  // Classify user input as space vs query
  ipcMain.handle('space:classify', async (_event, text: string) => {
    if (!isInitialized()) return { type: 'space' };
    const allSpaces = listSpaces();
    const recent = allSpaces.map(i => ({
      description: i.description,
      status: i.status,
      due_at: i.due_at,
      completed_at: i.completed_at,
    }));
    return classifyInput(text, recent);
  });

  // Summarize canvas content into a title
  ipcMain.handle('space:summarize-title', async (_event, canvasContent: string) => {
    try {
      const parsed = await parseSpaceWithAI(canvasContent);
      return { title: parsed.description };
    } catch (err) {
      console.error('[ipc] Summarize title failed:', err);
      return { title: null };
    }
  });

  ipcMain.handle('space:search', (_event, query: string) => {
    if (!isInitialized()) return [];
    return searchSpaces(query);
  });

  ipcMain.handle('space:unarchive', async (_event, id: string) => {
    const current = getSpace(id);
    if (!current || current.status !== 'done') return null;

    const updated = updateSpace(id, { status: 'captured', completed_at: null });
    if (updated) {
      logSpaceEvent(id, 'unarchived');

      const workspace = getConfigValue('workspace');
      if (workspace && updated.folder) {
        await commitNow(workspace);
        unarchiveSpaceFolder(workspace, updated.folder);
        scheduleAutoCommit(workspace);
      }
    }
    return updated;
  });
}
