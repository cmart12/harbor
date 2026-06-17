// Pin userData to a stable, productName-independent location. MUST be first so
// the path is set before any module resolves app.getPath('userData') at load.
import './app-paths';
import { app, BrowserWindow, dialog, globalShortcut, session, protocol, net, systemPreferences } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig, getConfigValue, setConfigValue, getResolvedHotkeys } from './config';
import { initDatabase, mergeSessionIds, syncCanvasContent } from './database';
import { initWorkspace, getDbPath, getLogRoot } from './workspace';
import { startSkillWatcher } from './skill-watcher';
import { startScheduler, stopScheduler } from './services/scheduler';
import { migrateOldDatabase } from './migration';
import { compactOldSegments } from './compaction';
import { registerIpcHandlers } from './ipc';
import { preloadModel } from './voice';
import { initCopilot, shutdownCopilot } from './ai';
import { startCliExitMonitor, stopCliExitMonitor, reconcileStaleAgents } from './agent-service';
import { createMainWindow, toggleWindow, setupSnapOnDrop, registerWindowIpcHandlers, preWarmSettingsWindow, releaseSettingsWindow, preWarmCanvasWindow, releaseCanvasWindow } from './window-manager';
import { createTray, destroyTray } from './tray';
import { initAutoUpdater, cleanupAutoUpdater } from './update-service';
import { syncWebRemoteServer, stopWebRemoteServer } from './web/server';
import { openNotifDb, closeNotifDb } from './notif-db';
import { MacOSNotifSource } from './notif-sources/macos-source';
import { WorkIQNotifSource } from './notif-sources/workiq-source';
import { startClassifierSweep, stopClassifierSweep } from './classifier/classifier';
import { initMainLog, logStartupBanner } from './main-log';
import type { NotifSource } from './notif-sources/types';
import { setSourceController } from './ipc/source-handlers';
import { getSourceSettings } from './notif-db';

let currentToggleAccelerator: string | null = null;
let notifSource: NotifSource | null = null;
let workiqSource: WorkIQNotifSource | null = null;

// Windows toast notifications require an AppUserModelId to be properly
// associated with the app in the notification center.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.patniko.whim');
}

// Suppress EPIPE errors that bubble up from vscode-jsonrpc when the Copilot
// CLI subprocess exits before the SDK finishes writing to its stdin. These are
// expected during SDK init failures and are already handled by initCopilot's
// catch block — the unhandled rejection / uncaught exception is just the
// async write draining after the process is gone.
process.on('uncaughtException', (err) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') {
    console.warn('[main] Suppressed stream error (CLI subprocess likely exited):', err.message);
    return;
  }
  // Re-throw non-stream errors so Electron's default handler shows the dialog
  throw err;
});

process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error) {
    const code = (reason as NodeJS.ErrnoException).code;
    if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') {
      console.warn('[main] Suppressed unhandled stream rejection (CLI subprocess likely exited):', reason.message);
      return;
    }
  }
  // Log but don't crash for other unhandled rejections
  console.error('[main] Unhandled promise rejection:', reason);
});

/**
 * Register (or re-register) the global toggle-window shortcut.
 * Only unregisters the previous toggle shortcut (not all global shortcuts).
 * Returns true on success, false if the OS refused the binding.
 */
export function registerToggleShortcut(accelerator: string): boolean {
  if (currentToggleAccelerator) {
    globalShortcut.unregister(currentToggleAccelerator);
  }
  const registered = globalShortcut.register(accelerator, toggleWindow);
  if (registered) {
    currentToggleAccelerator = accelerator;
  } else {
    console.warn(`[main] Failed to register global shortcut "${accelerator}" — another process may be holding it`);
    // Attempt to restore the previous shortcut
    if (currentToggleAccelerator) {
      globalShortcut.register(currentToggleAccelerator, toggleWindow);
    }
  }
  return registered;
}

// Register custom scheme as privileged (must happen before app ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'copilot-whim',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
};

app.whenReady().then(async () => {
  try {
  // Initialize the dual-transport logger before anything else logs.
  initMainLog();
  logStartupBanner();

  // Register custom protocol to serve renderer files (Web Speech API needs a real origin, not file://)
  // Also serves workspace attachment files via copilot-whim://app/workspace/<intentFolder>/<path>
  protocol.handle('copilot-whim', (request) => {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Serve workspace attachments: /workspace/<folder>/<relativePath>
    if (pathname.startsWith('/workspace/')) {
      const workspace = getConfigValue('workspace');
      if (!workspace) {
        return new Response('No workspace', { status: 404 });
      }

      const relativePath = pathname.slice('/workspace/'.length);
      const fullPath = path.resolve(path.join(workspace, relativePath));
      const workspaceRoot = path.resolve(workspace);

      // Security: ensure path stays within workspace
      if (!fullPath.startsWith(workspaceRoot)) {
        return new Response('Forbidden', { status: 403 });
      }

      if (!fs.existsSync(fullPath)) {
        return new Response('Not found', { status: 404 });
      }

      const ext = path.extname(fullPath);
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      return net.fetch('file://' + fullPath.replace(/\\/g, '/'), {
        headers: { 'Content-Type': mimeType },
      });
    }

    // Default: serve app renderer files
    // URL: whim://app/renderer/index.html → host="app", pathname="/renderer/index.html"
    const filePath = path.join(__dirname, '..', pathname);
    const ext = path.extname(filePath);
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    if (!fs.existsSync(filePath)) {
      console.error('Protocol: file not found:', filePath);
      return new Response('Not found', { status: 404 });
    }
    return net.fetch('file://' + filePath.replace(/\\/g, '/'), {
      headers: { 'Content-Type': mimeType },
    });
  });

  // Grant microphone permission for Web Speech API
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'microphone'];
    callback(allowed.includes(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    const allowed = ['media', 'audioCapture', 'microphone'];
    return allowed.includes(permission);
  });

  // Request macOS system-level mic access (triggers the OS permission dialog)
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').then(granted => {
      if (!granted) console.warn('[main] Microphone access denied by macOS');
    });
  }

  // Load local config and initialize workspace if configured
  const config = loadConfig();
  const workspace = config.workspace;

  if (workspace && fs.existsSync(workspace)) {
    initWorkspace(workspace);
    migrateOldDatabase(workspace);
    initDatabase(getDbPath(workspace), getLogRoot(workspace));
    mergeSessionIds(config.sessions);
    syncCanvasContent(workspace);
    startSkillWatcher(workspace);
    startScheduler();
    // Phase A.2: open sidecar notifications DB. Lives next to whim.db
    // under <userData>/notifications.db. Independent of the workspace
    // path, so opens even if workspace path resolution races.
    try { openNotifDb(); } catch (err) {
      console.warn('[main] openNotifDb failed:', err);
    }

    // Background compaction — fold events older than the 30-day keep
    // window into a single snapshot.jsonl. Runs once after startup
    // (deferred to idle so it doesn't compete with first-paint work)
    // and then once a day for long-running sessions. Cheap to call
    // when no segments are cold.
    scheduleCompaction(workspace);
  } else if (workspace) {
    // Workspace path configured but directory missing — clear it
    console.warn(`[main] Workspace directory not found: ${workspace}`);
    setConfigValue('workspace', null);
  }
  // If no workspace, DB is not initialized — IPC handlers return empty/error states
  await syncWebRemoteServer();

  // ── Module initialization ──────────────────────────────
  const preloadPath = path.join(__dirname, 'preload.js');

  registerIpcHandlers();
  const mainWin = createMainWindow({ preloadPath });
  registerWindowIpcHandlers(preloadPath);
  setupSnapOnDrop();
  createTray();
  preloadModel();
  initCopilot();
  startCliExitMonitor();
  reconcileStaleAgents();
  initAutoUpdater();

  // Phase A.2: spawn the macOS notification reader. No-op on non-darwin.
  if (process.platform === 'darwin') {
    notifSource = new MacOSNotifSource();
    try {
      notifSource.start();
    } catch (err) {
      console.warn('[main] MacOSNotifSource.start failed:', err);
      notifSource = null;
    }
  }

  // Phase C.1: spawn WorkIQ source (Outlook + Teams via Copilot SDK).
  // Honors the per-source enable flag from source_settings.
  {
    const outlookEnabled = getSourceSettings('workiq-outlook')?.enabled ?? true;
    const teamsEnabled = getSourceSettings('workiq-teams')?.enabled ?? true;

    if (outlookEnabled || teamsEnabled) {
      workiqSource = new WorkIQNotifSource();
      try {
        workiqSource.start();
      } catch (err) {
        console.warn('[main] WorkIQNotifSource.start failed:', err);
        workiqSource = null;
      }
    }

    // Wire the source controller so IPC handlers can manage sources.
    setSourceController({
      isRunning(source: string): boolean {
        if (source === 'macos') return notifSource !== null;
        if (source === 'workiq-outlook' || source === 'workiq-teams') return workiqSource !== null;
        return false;
      },
      setEnabled(source: string, enabled: boolean): void {
        if (source === 'workiq-outlook' || source === 'workiq-teams') {
          if (enabled && !workiqSource) {
            workiqSource = new WorkIQNotifSource();
            workiqSource.start().catch(err => {
              console.warn('[main] WorkIQ start failed:', err);
            });
          } else if (!enabled) {
            // Only stop if BOTH workiq sources are disabled
            const otherSource = source === 'workiq-outlook' ? 'workiq-teams' : 'workiq-outlook';
            const otherEnabled = getSourceSettings(otherSource)?.enabled ?? false;
            if (!otherEnabled && workiqSource) {
              workiqSource.stop().catch(err => {
                console.warn('[main] WorkIQ stop failed:', err);
              });
              workiqSource = null;
            }
          }
        }
        // macOS source toggle: simple start/stop
        if (source === 'macos') {
          if (enabled && !notifSource && process.platform === 'darwin') {
            notifSource = new MacOSNotifSource();
            notifSource.start().catch(err => {
              console.warn('[main] macOS start failed:', err);
            });
          } else if (!enabled && notifSource) {
            notifSource.stop().catch(err => {
              console.warn('[main] macOS stop failed:', err);
            });
            notifSource = null;
          }
        }
      },
      forceRebackfill(source: string): void {
        if (source === 'workiq-outlook' || source === 'workiq-teams') {
          // Cursor already cleared by handler; restart worker to pick up null cursor
          if (workiqSource) {
            workiqSource.stop().then(() => {
              workiqSource = new WorkIQNotifSource();
              return workiqSource.start();
            }).catch(err => {
              console.warn('[main] WorkIQ rebackfill restart failed:', err);
            });
          }
        }
      },
      pollNow(source: string): void {
        if ((source === 'workiq-outlook' || source === 'workiq-teams') && workiqSource) {
          workiqSource.pollNow();
        }
      },
    });
  }

  // Phase B.2: background sweep for pending classifications. Cheap, opts
  // out gracefully when the SDK isn't ready, drains rows that were left
  // pending across a restart.
  try { startClassifierSweep(); } catch (err) {
    console.warn('[main] startClassifierSweep failed:', err);
  }

  // Auto-show window on launch once content has loaded
  mainWin.webContents.once('did-finish-load', () => {
    toggleWindow();

    // Pre-warm the settings + canvas windows in the background so the first
    // open of each is instant. Skip when no workspace is configured (welcome
    // flow) to keep first-launch cheap for new users.
    if (workspace && fs.existsSync(workspace)) {
      // Defer to idle so the main window finishes animating in first.
      setTimeout(() => {
        try {
          preWarmSettingsWindow(preloadPath);
        } catch (err) {
          console.warn('[main] Settings pre-warm failed:', err);
        }
        try {
          preWarmCanvasWindow(preloadPath);
        } catch (err) {
          console.warn('[main] Canvas pre-warm failed:', err);
        }
      }, 1500);
    }
  });

  // Dev mode: watch renderer files and auto-reload windows
  if (!app.isPackaged) {
    const rendererDir = path.join(__dirname, '..', 'renderer');
    fs.watch(rendererDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      console.log(`[dev] Renderer file changed: ${filename}, reloading...`);
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.reload();
      }
    });
  }

  const hotkeys = getResolvedHotkeys();
  registerToggleShortcut(hotkeys.toggleWindow);
  } catch (err) {
    console.error('[main] Fatal startup error:', err);
    dialog.showErrorBox('whim — Startup Error',
      `The app failed to initialize:\n\n${err instanceof Error ? err.message : String(err)}`);
    app.quit();
  }
});

app.on('before-quit', () => {
  // Let the settings + canvas windows' `close` handlers actually close them
  // now that the app is quitting (normally we intercept close to hide for
  // speed).
  releaseSettingsWindow();
  releaseCanvasWindow();
});

app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  stopCliExitMonitor();
  stopScheduler();
  await stopWebRemoteServer();
  cleanupAutoUpdater();
  destroyTray();
  await shutdownCopilot();
  // Phase A.2: graceful notif source + sidecar DB teardown.
  if (notifSource) {
    try { await notifSource.stop(); } catch (e) { console.warn('[main] notif stop:', e); }
    notifSource = null;
  }
  // Phase C.1: tear down WorkIQ source.
  if (workiqSource) {
    try { await workiqSource.stop(); } catch (e) { console.warn('[main] workiq stop:', e); }
    workiqSource = null;
  }
  try { stopClassifierSweep(); } catch (e) { console.warn('[main] stopClassifierSweep:', e); }
  try { closeNotifDb(); } catch (e) { console.warn('[main] closeNotifDb:', e); }
});

app.on('window-all-closed', () => {
  // Don't quit — the app stays alive in the system tray
  if (process.platform === 'darwin') {
    // On macOS this is standard behavior (app stays in dock)
  }
});

/**
 * Schedule background log compaction. Runs once at idle after startup
 * (so it doesn't compete with first-paint or DB-replay work) and then
 * once every 24 hours for long-running sessions.
 *
 * Compaction itself is cheap when nothing is cold: it just stats the
 * segment files and exits early. The 24h cadence is intentionally
 * generous — segments only become eligible after 30 days, so more
 * frequent runs would be wasted work.
 */
function scheduleCompaction(workspace: string): void {
  const logRoot = getLogRoot(workspace);
  const dayMs = 24 * 60 * 60 * 1000;

  const run = (): void => {
    try {
      const result = compactOldSegments(logRoot);
      if (result.ran) {
        console.log(
          `[main] Compaction folded ${result.compactedSegments} segment(s) ` +
          `and GC'd ${result.removedSideFiles ?? 0} side file(s)`,
        );
      }
    } catch (err) {
      console.warn('[main] Compaction run failed:', err);
    }
  };

  // First run: 30 seconds after startup so DB init + window paint finish first.
  setTimeout(run, 30 * 1000).unref();
  // Periodic: once a day for sessions that stay open.
  setInterval(run, dayMs).unref();
}
