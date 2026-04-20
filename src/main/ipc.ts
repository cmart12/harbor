import { ipcMain, BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';
import { isInitialized, createIntent, listIntents, updateIntent, updateIntentCAS, deleteIntent, getIntent, logIntentEvent, listIntentEvents } from './database';
import { parseIntentWithAI, evaluateRecurrence, findSimilarIntent, resolveDateWithAI, classifyInput, setAIModel, listAvailableModels } from './ai';
import { launchSession, getActiveSessionIntentIds } from './session';
import { transcribeAudio } from './voice';
import { CreateIntentInput, Intent, RecurrenceResult } from '../shared/types';
import { getConfigValue, setConfigValue } from './config';
import { initWorkspace, getDbPath, getLogPath } from './workspace';
import { initDatabase, mergeSessionIds } from './database';
import { getConfig } from './config';

// Track in-flight recurrence evaluations so we can cancel them
const pendingRecurrences = new Map<string, { result: RecurrenceResult; version: string; timer: ReturnType<typeof setTimeout> }>();

function notifyAllWindows(channel: string, ...args: any[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

async function processIntentInBackground(id: string, body: string, createdVersion: string): Promise<void> {
  try {
    const parsed = await parseIntentWithAI(body);
    // CAS: only apply AI results if intent hasn't been edited since creation
    updateIntentCAS(id, createdVersion, {
      description: parsed.description,
      client: parsed.client,
      due_at: parsed.due_at,
      due_at_utc: parsed.due_at_utc,
    });
    notifyAllWindows('intent:processed', id);

    // After refinement, search for similar past intents (recall)
    searchForRecall(id, parsed.description);
  } catch (err) {
    console.error('[ipc] Background intent processing failed:', err);
  }
}

async function searchForRecall(intentId: string, description: string): Promise<void> {
  try {
    const allIntents = listIntents();
    // Exclude the intent itself, get recent ones (last 30)
    const candidates = allIntents
      .filter(i => i.id !== intentId)
      .slice(0, 30);

    if (candidates.length === 0) return;

    // Prefilter: simple word overlap scoring to narrow to top 8
    const words = new Set(description.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const scored = candidates.map(c => {
      const cWords = (c.description || '').toLowerCase().split(/\s+/);
      const overlap = cWords.filter(w => words.has(w)).length;
      return { intent: c, overlap };
    });
    scored.sort((a, b) => b.overlap - a.overlap);
    const topCandidates = scored.slice(0, 8).map(s => s.intent);

    if (topCandidates.length === 0) return;

    const match = await findSimilarIntent(description, topCandidates);
    if (match) {
      notifyAllWindows('intent:recall', intentId, match);
    }
  } catch (err) {
    console.error('[ipc] Recall search failed:', err);
  }
}

async function handleRecurrence(intent: Intent, version: string): Promise<void> {
  try {
    const result = await evaluateRecurrence({
      raw_text: intent.raw_text,
      description: intent.description,
      due_at: intent.due_at,
      due_at_utc: intent.due_at_utc,
      completed_at: intent.completed_at!,
    });

    if (!result.should_recur) {
      notifyAllWindows('intent:recurrence', intent.id, result);
      return;
    }

    // Send result to renderer immediately for preview
    notifyAllWindows('intent:recurrence', intent.id, result);

    // Start undo window — apply recurrence after 5 seconds
    const timer = setTimeout(() => {
      applyRecurrence(intent.id, version, result);
      pendingRecurrences.delete(intent.id);
    }, 5000);

    pendingRecurrences.set(intent.id, { result, version, timer });
  } catch (err) {
    console.error('[ipc] Recurrence evaluation failed:', err);
  }
}

function applyRecurrence(intentId: string, expectedVersion: string, result: RecurrenceResult): void {
  const updated = updateIntentCAS(intentId, expectedVersion, {
    status: 'captured',
    due_at: result.next_due,
    due_at_utc: result.next_due_utc,
    recurrence: JSON.stringify(result),
  });

  if (updated) {
    const current = getIntent(intentId);
    logIntentEvent(intentId, 'recycled', {
      due_at: result.next_due,
      due_at_utc: result.next_due_utc,
      recurrence_json: JSON.stringify(result),
    });
    notifyAllWindows('intent:recurrence-applied', intentId);
    console.log(`[ipc] Recurrence applied for ${intentId}: next due ${result.next_due}`);
  } else {
    console.log(`[ipc] Recurrence CAS failed for ${intentId} — intent was modified`);
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('intent:create', (_event, input: CreateIntentInput) => {
    if (!isInitialized()) return { error: 'no_workspace' };
    const intent = createIntent(input);
    processIntentInBackground(intent.id, intent.body || intent.description, intent.updated_at);
    return intent;
  });

  ipcMain.handle('intent:list', () => {
    if (!isInitialized()) return [];
    return listIntents();
  });

  ipcMain.handle('intent:update', (_event, id: string, updates: Partial<Pick<Intent, 'description' | 'body' | 'client' | 'due_at' | 'due_at_utc' | 'status' | 'attachments'>>) => {
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
        }
        return updated;
      }
    }

    return updateIntent(id, updates);
  });

  ipcMain.handle('intent:delete', (_event, id: string) => {
    // Cancel any pending recurrence
    const pending = pendingRecurrences.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRecurrences.delete(id);
    }
    return deleteIntent(id);
  });

  ipcMain.handle('intent:dismiss-recurrence', (_event, id: string) => {
    const pending = pendingRecurrences.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRecurrences.delete(id);
      logIntentEvent(id, 'recurrence_dismissed', {
        recurrence_json: JSON.stringify(pending.result),
      });
      console.log(`[ipc] Recurrence dismissed for ${id}`);
    }
    return true;
  });

  ipcMain.handle('voice:transcribe', async (_event, audioData: number[]) => {
    const float32 = new Float32Array(audioData);
    return transcribeAudio(float32);
  });

  // Settings — backed by local config.json
  ipcMain.handle('settings:get', (_event, key: string) => {
    const configKeyMap: Record<string, keyof ReturnType<typeof getConfig>> = {
      workspace_root: 'workspace',
      theme: 'theme',
      model: 'model',
    };
    const configKey = configKeyMap[key];
    if (configKey) return getConfigValue(configKey);
    return null;
  });

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    if (key === 'theme') {
      setConfigValue('theme', value as 'light' | 'dark');
    } else if (key === 'model') {
      setConfigValue('model', value);
      await setAIModel(value);
    }
  });

  ipcMain.handle('models:list', async () => {
    return listAvailableModels();
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
    const allIntents = listIntents();
    const recent = allIntents.map(i => ({
      description: i.description,
      status: i.status,
      due_at: i.due_at,
      completed_at: i.completed_at,
    }));
    return classifyInput(text, recent);
  });

  // Session launch
  ipcMain.handle('session:launch', async (_event, intentId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !fs.existsSync(workspace)) {
      return { success: false, error: 'no_workspace' };
    }
    if (!isInitialized()) {
      return { success: false, error: 'no_workspace' };
    }
    return launchSession(intentId, workspace);
  });

  // Query which intents have active running terminal processes
  ipcMain.handle('session:active-intents', () => {
    return getActiveSessionIntentIds();
  });

  // Workspace directory picker — initializes workspace + DB on selection
  ipcMain.handle('workspace:select', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);

    // Suppress blur-hide while dialog is open
    if (win) {
      win.removeAllListeners('blur');
    }

    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Workspace Directory',
        properties: ['openDirectory'],
        defaultPath: getConfigValue('workspace') || undefined,
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const dir = result.filePaths[0];
        setConfigValue('workspace', dir);

        // Initialize workspace structure and DB
        initWorkspace(dir);
        initDatabase(getDbPath(dir), getLogPath(dir));
        mergeSessionIds(getConfig().sessions);

        return { selected: true, path: dir };
      }
      return { selected: false, path: null };
    } finally {
      // Restore blur-hide behavior
      if (win) {
        let showTimestamp = Date.now();
        win.on('blur', () => {
          if (Date.now() - showTimestamp < 300) return;
          win.hide();
        });
      }
    }
  });
}
