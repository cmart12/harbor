import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as fs from 'fs';
import { isInitialized } from '../database';
import { launchSession, getActiveSessionIntentIds } from '../session';
import { transcribeAudio } from '../voice';
import { getConfigValue, setConfigValue, getConfig } from '../config';
import { initWorkspace, getDbPath, getLogPath } from '../workspace';
import { initDatabase, mergeSessionIds, syncCanvasContent } from '../database';
import { startSkillWatcher } from '../skill-watcher';

export function registerWorkspaceHandlers(): void {
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
        syncCanvasContent(dir);
        startSkillWatcher(dir);

        return { selected: true, path: dir };
      }
      return { selected: false, path: null };
    } finally {
      // Restore blur-hide behavior
      if (win) {
        const restoreTs = Date.now();
        win.on('blur', async () => {
          if (Date.now() - restoreTs < 300) return;
          try {
            const shouldStay = await win.webContents.executeJavaScript(
              `(function() {
                var input = document.getElementById('description-input');
                var hasInput = input && input.value.trim().length > 0;
                var canvasOpen = !document.getElementById('canvas-view').classList.contains('hidden');
                return hasInput || canvasOpen;
              })()`
            );
            if (shouldStay) return;
          } catch { /* hide on failure */ }
          win.hide();
        });
      }
    }
  });

  // Open a folder in the system file manager
  ipcMain.handle('shell:openPath', (_event, folderPath: string) => {
    return shell.openPath(folderPath);
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

  ipcMain.handle('voice:transcribe', async (_event, audioData: number[]) => {
    const float32 = new Float32Array(audioData);
    return transcribeAudio(float32);
  });
}
