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

  win.on('blur', () => {
    // Ignore blur if window was just shown (e.g. from tray menu click)
    if (Date.now() - showTimestamp < 300) return;
    win.hide();
  });

  return win;
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
  protocol.handle('copilot-intent', (request) => {
    const url = new URL(request.url);
    // URL: intent://app/renderer/index.html → host="app", pathname="/renderer/index.html"
    const filePath = path.join(__dirname, '..', url.pathname);
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
});

app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  await shutdownCopilot();
});

app.on('window-all-closed', () => {
  // Keep app running in tray — do nothing
});
