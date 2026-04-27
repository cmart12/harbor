import { ipcMain } from 'electron';
import { isInitialized, createIntent, listIntents, updateIntent, deleteIntent, getIntent, logIntentEvent, listIntentEvents, assignIntentFolder, searchIntents } from '../database';
import { parseIntentWithAI, resolveDateWithAI, classifyInput } from '../ai';
import { CreateIntentInput, Intent } from '../../shared/types';
import { getConfigValue } from '../config';
import { initIntentCanvas, scheduleAutoCommit, commitNow, archiveIntentFolder, deleteIntentFolder } from '../workspace';
import { handleRecurrence, dismissRecurrence, cancelPendingRecurrence } from '../services/recurrence';
import { processIntentInBackground } from '../services/intent-processing';

export function registerIntentHandlers(): void {
  ipcMain.handle('intent:create', (_event, input: CreateIntentInput) => {
    if (!isInitialized()) return { error: 'no_workspace' };
    const intent = createIntent(input);

    // Eagerly create folder + canvas seeded with body
    const workspace = getConfigValue('workspace');
    if (workspace) {
      const folder = initIntentCanvas(workspace, intent.id, intent.description, intent.body);
      assignIntentFolder(intent.id, folder);
      intent.folder = folder;
      scheduleAutoCommit(workspace);
    }

    processIntentInBackground(intent.id, intent.body || intent.description, intent.updated_at);
    return intent;
  });

  ipcMain.handle('intent:list', () => {
    if (!isInitialized()) return [];
    return listIntents();
  });

  ipcMain.handle('intent:update', async (_event, id: string, updates: Partial<Pick<Intent, 'description' | 'body' | 'client' | 'due_at' | 'due_at_utc' | 'status' | 'attachments'>>) => {
    // Detect transition to 'done' for recurrence evaluation
    if (updates.status === 'done') {
      const current = getIntent(id);
      if (current && current.status !== 'done') {
        // Real transition to done
        const completedAt = new Date().toISOString();
        const updated = updateIntent(id, { ...updates, completed_at: completedAt });
        if (updated) {
          logIntentEvent(id, 'completed', {
            due_at: updated.due_at,
            due_at_utc: updated.due_at_utc,
            completed_at: completedAt,
          });

          // If this is a dated intent, evaluate recurrence
          if (updated.due_at_utc || updated.due_at) {
            handleRecurrence(updated, updated.updated_at);
          }

          // Commit all pending changes, then archive the folder
          const workspace = getConfigValue('workspace');
          if (workspace && updated.folder) {
            await commitNow(workspace);
            archiveIntentFolder(workspace, updated.folder);
            scheduleAutoCommit(workspace);
          }
        }
        return updated;
      }
    }

    // If body is being set (e.g., from canvas write-then-close), trigger AI refinement
    if (updates.body && updates.body.trim()) {
      const current = getIntent(id);
      if (current && (!current.description || current.description === '' || current.description === current.body)) {
        const updated = updateIntent(id, updates);
        if (updated) {
          processIntentInBackground(id, updates.body, updated.updated_at);
        }
        return updated;
      }
    }

    return updateIntent(id, updates);
  });

  ipcMain.handle('intent:delete', (_event, id: string) => {
    const current = getIntent(id);
    cancelPendingRecurrence(id);
    const result = deleteIntent(id);
    const workspace = getConfigValue('workspace');
    if (workspace) {
      if (current?.folder) {
        deleteIntentFolder(workspace, current.folder);
      }
      scheduleAutoCommit(workspace);
    }
    return result;
  });

  ipcMain.handle('intent:dismiss-recurrence', (_event, id: string) => {
    dismissRecurrence(id);
    return true;
  });

  // Intent events / timeline
  ipcMain.handle('intent:events', (_event, limit?: number) => {
    return listIntentEvents(limit || 100);
  });

  // Resolve natural language date
  ipcMain.handle('intent:resolve-date', async (_event, dateText: string) => {
    return resolveDateWithAI(dateText);
  });

  // Classify user input as intent vs query
  ipcMain.handle('intent:classify', async (_event, text: string) => {
    if (!isInitialized()) return { type: 'intent' };
    const allIntents = listIntents();
    const recent = allIntents.map(i => ({
      description: i.description,
      status: i.status,
      due_at: i.due_at,
      completed_at: i.completed_at,
    }));
    return classifyInput(text, recent);
  });

  // Summarize canvas content into a title
  ipcMain.handle('intent:summarize-title', async (_event, canvasContent: string) => {
    try {
      const parsed = await parseIntentWithAI(canvasContent);
      return { title: parsed.description };
    } catch (err) {
      console.error('[ipc] Summarize title failed:', err);
      return { title: null };
    }
  });

  ipcMain.handle('intent:search', (_event, query: string) => {
    if (!isInitialized()) return [];
    return searchIntents(query);
  });
}
