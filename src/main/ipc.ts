import { ipcMain } from 'electron';
import { createIntent, listIntents, updateIntent, deleteIntent } from './database';
import { parseIntentWithAI } from './ai';
import { CreateIntentInput, Intent } from '../shared/types';

export function registerIpcHandlers(): void {
  ipcMain.handle('intent:create', (_event, input: CreateIntentInput) => {
    return createIntent(input);
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

  ipcMain.handle('intent:parse', (_event, rawText: string) => {
    return parseIntentWithAI(rawText);
  });
}
