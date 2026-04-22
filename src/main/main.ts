import { app, BrowserWindow, Tray, Menu, globalShortcut, screen, ipcMain, nativeImage, session, protocol, net, systemPreferences } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig, getConfigValue, setConfigValue } from './config';
import { initDatabase, mergeSessionIds, syncCanvasContent } from './database';
import { initWorkspace, getDbPath, getLogPath } from './workspace';
import { migrateOldDatabase } from './migration';
import { registerIpcHandlers } from './ipc';
import { preloadModel } from './voice';
import { initCopilot, shutdownCopilot } from './ai';

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 520;
const EXPANDED_WIDTH = 720;
const EXPANDED_HEIGHT = 700;

let isExpanded = false;

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

let showTimestamp = 0;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load via custom protocol so Web Speech API works (needs a real origin, not file://)
  // Use intent://app/renderer/index.html so host="app" and pathname="/renderer/index.html"
  win.loadURL('copilot-intent://app/renderer/index.html');

  attachBlurHide(win);

  return win;
}

/** Attach blur handler that hides the window only when the user isn't actively working. */
function attachBlurHide(win: BrowserWindow): void {
  win.on('blur', async () => {
    // Ignore blur if window was just shown (e.g. from tray menu click)
    if (Date.now() - showTimestamp < 300) return;

    // Don't auto-hide if the user has content in the input or is on a sub-view
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
    } catch {
      // If check fails, hide anyway
    }

    win.hide();
  });
}

function getWindowPosition(): { x: number; y: number } {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width, height } = display.workArea;

  // Position near bottom-right (above taskbar)
  return {
    x: x + width - WINDOW_WIDTH - 12,
    y: y + height - WINDOW_HEIGHT - 12,
  };
}

function toggleWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    const pos = getWindowPosition();
    showTimestamp = Date.now();
    mainWindow.setPosition(pos.x, pos.y, false);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('window:shown');
  }
}

function createTray(): void {
  const iconPath = path.join(__dirname, '..', '..', 'src', 'assets', 'tray-icon.png');
  const fallbackPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  const resolvedPath = fs.existsSync(iconPath) ? iconPath : fallbackPath;

  let icon: Electron.NativeImage;
  if (fs.existsSync(resolvedPath)) {
    icon = nativeImage.createFromPath(resolvedPath);
  } else {
    // Fallback: inline 16x16 lightning bolt
    icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'src', 'assets', 'tray-icon-16.png'));
  }

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Intent — Quick Capture');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: toggleWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', toggleWindow);
}

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
  } else if (workspace) {
    // Workspace path configured but directory missing — clear it
    console.warn(`[main] Workspace directory not found: ${workspace}`);
    setConfigValue('workspace', null);
  }
  // If no workspace, DB is not initialized — IPC handlers return empty/error states

  registerIpcHandlers();
  createTray();
  mainWindow = createWindow();
  preloadModel();
  initCopilot();

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

  ipcMain.on('window:hide', () => {
    mainWindow?.hide();
  });

  ipcMain.on('window:expand', () => {
    if (!mainWindow || isExpanded) return;
    isExpanded = true;

    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const { x, y, width, height } = display.workArea;

    // Center the expanded window on the display
    const newX = Math.round(x + (width - EXPANDED_WIDTH) / 2);
    const newY = Math.round(y + (height - EXPANDED_HEIGHT) / 2);

    mainWindow.setResizable(true);
    mainWindow.setBounds({ x: newX, y: newY, width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT }, true);
  });

  ipcMain.on('window:collapse', () => {
    if (!mainWindow || !isExpanded) return;
    isExpanded = false;

    const pos = getWindowPosition();
    mainWindow.setBounds({ x: pos.x, y: pos.y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT }, true);
    mainWindow.setResizable(false);
  });
});

app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  await shutdownCopilot();
});

app.on('window-all-closed', () => {
  // Keep app running in tray — do nothing
});
