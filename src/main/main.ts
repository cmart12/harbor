import { app, BrowserWindow, globalShortcut, session, protocol, net, systemPreferences } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig, getConfigValue, setConfigValue } from './config';
import { initDatabase, mergeSessionIds, syncCanvasContent } from './database';
import { initWorkspace, getDbPath, getLogPath } from './workspace';
import { startSkillWatcher } from './skill-watcher';
import { migrateOldDatabase } from './migration';
import { registerIpcHandlers } from './ipc';
import { preloadModel } from './voice';
import { initCopilot, shutdownCopilot } from './ai';
import { startCliExitMonitor, stopCliExitMonitor } from './agent-service';
import { createMainWindow, toggleWindow, setupSnapOnDrop, registerWindowIpcHandlers } from './window-manager';
import { createTray } from './tray-controller';

// Prevent tray from being garbage-collected
let tray: Electron.Tray | null = null;

// Register custom scheme as privileged (must happen before app ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'copilot-intent',
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
  // Register custom protocol to serve renderer files (Web Speech API needs a real origin, not file://)
  // Also serves workspace attachment files via copilot-intent://app/workspace/<intentFolder>/<path>
  protocol.handle('copilot-intent', (request) => {
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
    // URL: intent://app/renderer/index.html → host="app", pathname="/renderer/index.html"
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
    initDatabase(getDbPath(workspace), getLogPath(workspace));
    mergeSessionIds(config.sessions);
    syncCanvasContent(workspace);
    startSkillWatcher(workspace);
  } else if (workspace) {
    // Workspace path configured but directory missing — clear it
    console.warn(`[main] Workspace directory not found: ${workspace}`);
    setConfigValue('workspace', null);
  }
  // If no workspace, DB is not initialized — IPC handlers return empty/error states

  // ── Module initialization ──────────────────────────────
  const preloadPath = path.join(__dirname, 'preload.js');

  registerIpcHandlers();
  tray = createTray({ onToggleWindow: toggleWindow, onQuit: () => app.quit() });
  createMainWindow({ preloadPath });
  registerWindowIpcHandlers(preloadPath);
  setupSnapOnDrop();
  preloadModel();
  initCopilot();
  startCliExitMonitor();

  // Auto-show window on first launch so new users see the welcome screen
  if (!workspace) {
    toggleWindow();
  }

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

  const registered = globalShortcut.register('CommandOrControl+Shift+Space', toggleWindow);
  if (!registered) {
    console.warn('Failed to register Ctrl+Shift+Space — another process may be holding it');
  }
});

app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  stopCliExitMonitor();
  await shutdownCopilot();
});

app.on('window-all-closed', () => {
  // Keep app running in tray — do nothing
});
