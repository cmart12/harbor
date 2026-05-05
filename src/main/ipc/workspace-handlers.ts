import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as fs from 'fs';
import { isInitialized, closeDatabase } from '../database';
import { launchSession, getActiveSessionIntentIds } from '../session';
import { transcribeAudio } from '../voice';
import { getConfigValue, setConfigValue, getConfig } from '../config';
import { initWorkspace, getDbPath, getLogPath, getGitSyncStatus, gitFetchOrigin, gitPush, gitPull } from '../workspace';
import { initDatabase, mergeSessionIds, syncCanvasContent } from '../database';
import { startSkillWatcher, stopSkillWatcher } from '../skill-watcher';
import type { GitSyncStatus } from '../../shared/ipc-contract';

// ── Git sync polling ────────────────────────────────────
const GIT_SYNC_POLL_MS = 60_000;
let syncPollTimer: ReturnType<typeof setInterval> | null = null;
let lastSyncStatus: GitSyncStatus | null = null;

function broadcastSyncStatus(status: GitSyncStatus): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('workspace:git-sync-changed', status);
  }
}

async function pollGitSync(): Promise<void> {
  const workspace = getConfigValue('workspace');
  if (!workspace) return;

  try {
    await gitFetchOrigin(workspace);
  } catch {
    // Network may be unavailable — still check local status
  }

  try {
    const status = await getGitSyncStatus(workspace);
    // Broadcast only when status actually changes
    if (!lastSyncStatus
      || lastSyncStatus.ahead !== status.ahead
      || lastSyncStatus.behind !== status.behind
      || lastSyncStatus.available !== status.available
      || lastSyncStatus.branch !== status.branch
    ) {
      lastSyncStatus = status;
      broadcastSyncStatus(status);
    }
  } catch {
    // Silently skip
  }
}

function startSyncPolling(): void {
  stopSyncPolling();
  // Initial poll after a short delay to let workspace init finish
  setTimeout(() => pollGitSync(), 2000);
  syncPollTimer = setInterval(() => pollGitSync(), GIT_SYNC_POLL_MS);
}

function stopSyncPolling(): void {
  if (syncPollTimer) {
    clearInterval(syncPollTimer);
    syncPollTimer = null;
  }
  lastSyncStatus = null;
}

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

        // Close previous workspace cleanly
        stopSkillWatcher();
        closeDatabase();

        setConfigValue('workspace', dir);

        // Initialize workspace structure and DB
        initWorkspace(dir);
        initDatabase(getDbPath(dir), getLogPath(dir));
        mergeSessionIds(getConfig().sessions);
        syncCanvasContent(dir);
        startSkillWatcher(dir);

        // Notify all windows to reload data
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send('workspace:changed', dir);
        }

        // Start git sync polling for the new workspace
        startSyncPolling();

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
  ipcMain.handle('session:launch', async (_event, spaceId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !fs.existsSync(workspace)) {
      return { success: false, error: 'no_workspace' };
    }
    if (!isInitialized()) {
      return { success: false, error: 'no_workspace' };
    }
    return launchSession(spaceId, workspace);
  });

  // Query which intents have active running terminal processes
  ipcMain.handle('session:active-spaces', () => {
    return getActiveSessionIntentIds();
  });

  ipcMain.handle('voice:transcribe', async (_event, audioData: number[]) => {
    const float32 = new Float32Array(audioData);
    return transcribeAudio(float32);
  });

  // Clear workspace — returns app to fresh start state
  ipcMain.handle('workspace:clear', () => {
    stopSkillWatcher();
    stopSyncPolling();
    closeDatabase();
    setConfigValue('workspace', null);

    // Notify all windows to reload into fresh-start state
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('workspace:changed', null);
    }

    return { ok: true };
  });

  // ── Git sync handlers ──────────────────────────────────

  ipcMain.handle('workspace:git-status', async () => {
    const workspace = getConfigValue('workspace');
    if (!workspace) return { available: false, branch: null, ahead: 0, behind: 0, unavailableReason: 'not-a-repo' as const };
    return getGitSyncStatus(workspace);
  });

  ipcMain.handle('workspace:git-push', async () => {
    const workspace = getConfigValue('workspace');
    if (!workspace) return { error: 'No workspace selected' };
    const result = await gitPush(workspace);
    // Refresh status after push
    pollGitSync();
    return result;
  });

  ipcMain.handle('workspace:git-pull', async () => {
    const workspace = getConfigValue('workspace');
    if (!workspace) return { error: 'No workspace selected' };
    const result = await gitPull(workspace);
    // Refresh status after pull
    pollGitSync();
    return result;
  });

  // Start polling if workspace is already configured on startup
  if (getConfigValue('workspace')) {
    startSyncPolling();
  }
}
