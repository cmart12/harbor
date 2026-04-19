import { ipcMain, BrowserWindow } from 'electron';
import { createIntent, listIntents, updateIntent, deleteIntent, getSetting, setSetting } from './database';
import { parseIntentWithAI, setAIModel, listAvailableModels } from './ai';
import { transcribeAudio } from './voice';
import { CreateIntentInput, Intent } from '../shared/types';

async function processIntentInBackground(id: string, rawText: string): Promise<void> {
  try {
    const parsed = await parseIntentWithAI(rawText);
    updateIntent(id, {
      description: parsed.description,
      client: parsed.client,
      due_at: parsed.due_at,
    });
    // Notify all renderer windows
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('intent:processed', id);
    }
  } catch (err) {
    console.error('[ipc] Background intent processing failed:', err);
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('intent:create', (_event, input: CreateIntentInput) => {
    const intent = createIntent(input);
    // Fire-and-forget LLM processing
    processIntentInBackground(intent.id, intent.description);
    return intent;
  });

  ipcMain.handle('intent:list', () => {
    return listIntents();
  });

  ipcMain.handle('intent:update', (_event, id: string, updates: Partial<Pick<Intent, 'description' | 'client' | 'due_at' | 'status'>>) => {
    return updateIntent(id, updates);
  });

  ipcMain.handle('intent:delete', (_event, id: string) => {
    return deleteIntent(id);
  });

  ipcMain.handle('voice:transcribe', async (_event, audioData: number[]) => {
    const float32 = new Float32Array(audioData);
    return transcribeAudio(float32);
  });

  // Settings
  ipcMain.handle('settings:get', (_event, key: string) => {
    return getSetting(key);
  });

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    setSetting(key, value);
    if (key === 'model') {
      await setAIModel(value);
    }
  });

  ipcMain.handle('models:list', async () => {
    return listAvailableModels();
  });
}
