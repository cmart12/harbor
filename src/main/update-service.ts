import { app, ipcMain } from 'electron';
import type { UpdateState, UpdateStatus } from '../shared/types';
import { sendToAllWindows } from './ipc/typed-handler';
import { getConfigValue } from './config';

const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

let currentState: UpdateState = { status: 'disabled' };
let checkTimer: ReturnType<typeof setInterval> | null = null;

function setState(state: UpdateState) {
  currentState = state;
  sendToAllWindows('update:state-changed', state);
}

export function getUpdateState(): UpdateState {
  return currentState;
}

export function setAutoDownload(enabled: boolean) {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = enabled;
  } catch {}
}

export function initAutoUpdater() {
  if (!app.isPackaged) {
    setState({ status: 'disabled' });
    return;
  }

  let autoUpdater: any;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err: any) {
    console.error('[update] Failed to load electron-updater:', err?.message);
    setState({ status: 'disabled' });
    return;
  }

  autoUpdater.autoDownload = getConfigValue('autoDownloadUpdates');
  autoUpdater.autoInstallOnAppQuit = true;

  setState({ status: 'idle' });

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info: any) => {
    if (autoUpdater.autoDownload) {
      setState({ status: 'downloading', version: info?.version });
    } else {
      setState({ status: 'available', version: info?.version });
    }
  });

  autoUpdater.on('update-not-available', () => {
    setState({ status: 'idle' });
  });

  autoUpdater.on('download-progress', (progress: any) => {
    setState({
      status: 'downloading',
      version: currentState.version,
      progress: Math.round(progress?.percent ?? 0),
    });
  });

  autoUpdater.on('update-downloaded', (info: any) => {
    setState({ status: 'downloaded', version: info?.version });
  });

  autoUpdater.on('error', (err: any) => {
    console.error('[update] Error:', err?.message);
    setState({ status: 'error', error: err?.message });
    // Reset to idle after a delay so the banner doesn't stick on transient errors
    setTimeout(() => {
      if (currentState.status === 'error') setState({ status: 'idle' });
    }, 30_000);
  });

  // IPC handlers
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('update:check', () => {
    autoUpdater.checkForUpdates().catch((err: any) => {
      console.error('[update] Check failed:', err?.message);
    });
  });

  ipcMain.handle('update:download', () => {
    autoUpdater.downloadUpdate().catch((err: any) => {
      console.error('[update] Download failed:', err?.message);
    });
  });

  // Initial check
  autoUpdater.checkForUpdates().catch((err: any) => {
    console.error('[update] Initial check failed:', err?.message);
  });

  // Periodic checks
  checkTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch((err: any) => {
      console.error('[update] Periodic check failed:', err?.message);
    });
  }, CHECK_INTERVAL_MS);
}

export function cleanupAutoUpdater() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}
