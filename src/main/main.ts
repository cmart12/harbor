import { app, BrowserWindow, Tray, Menu, globalShortcut, screen, ipcMain, nativeImage, session, protocol, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { initDatabase } from './database';
import { registerIpcHandlers } from './ipc';

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 520;

// Register custom scheme as privileged (must happen before app ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'intent',
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
  win.loadURL('intent://renderer/index.html');

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
  // Create a simple icon programmatically
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA' +
    'mklEQVQ4T2NkoBAwUqifYdAY8B8E/v8HkYz/GRn/MzIy/mdgZPzPwMAAEmFkZGD4Dwbg' +
    'MJDh+/fvDP///2dkZGJi+P//P8P///8Z/v37x/Dv3z8GBgYGhv///jH8/fOH4e/fvwx/' +
    '//5l+PPnD8Pv378Zfv36xfDz508wG6aZkZER7AKQBpBmkEaQC0CaQS4AaQYBkGaYZnwA' +
    'ACLYRREFnOaAAAAAAElFTkSuQmCC'
  );

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
  protocol.handle('intent', (request) => {
    const url = new URL(request.url);
    const filePath = path.join(__dirname, '..', url.pathname);
    const ext = path.extname(filePath);
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    if (!fs.existsSync(filePath)) {
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

  await initDatabase();
  registerIpcHandlers();
  createTray();
  mainWindow = createWindow();

  const registered = globalShortcut.register('CommandOrControl+Shift+Space', toggleWindow);
  if (!registered) {
    console.warn('Failed to register Ctrl+Shift+Space — another process may be holding it');
  }

  ipcMain.on('window:hide', () => {
    mainWindow?.hide();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep app running in tray — do nothing
});
