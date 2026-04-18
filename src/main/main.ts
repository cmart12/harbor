import { app, BrowserWindow, Tray, Menu, globalShortcut, screen, ipcMain, nativeImage } from 'electron';
import * as path from 'path';
import { initDatabase } from './database';
import { registerIpcHandlers } from './ipc';

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 520;

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

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.on('blur', () => {
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
  await initDatabase();
  registerIpcHandlers();
  createTray();
  mainWindow = createWindow();

  globalShortcut.register('CommandOrControl+Shift+Space', toggleWindow);

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
