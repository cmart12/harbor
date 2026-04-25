import { app, BrowserWindow, Tray, Menu, globalShortcut, screen, ipcMain, nativeImage, session, protocol, net, systemPreferences } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig, getConfigValue, setConfigValue, type SnapPosition } from './config';
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
const SNAP_MARGIN = 12;

let isExpanded = false;
let isSnapping = false;

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

    // Never hide when pinned
    if (getConfigValue('pinned')) return;

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

/** Derive pixel coordinates from a snap position on the nearest display. */
function getSnapCoords(snap: SnapPosition, winWidth = WINDOW_WIDTH, winHeight = WINDOW_HEIGHT): { x: number; y: number } {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width, height } = display.workArea;

  let sx: number;
  let sy: number;

  switch (snap) {
    case 'top-left':
      sx = x + SNAP_MARGIN;
      sy = y + SNAP_MARGIN;
      break;
    case 'top-right':
      sx = x + width - winWidth - SNAP_MARGIN;
      sy = y + SNAP_MARGIN;
      break;
    case 'bottom-left':
      sx = x + SNAP_MARGIN;
      sy = y + height - winHeight - SNAP_MARGIN;
      break;
    case 'left-center':
      sx = x + SNAP_MARGIN;
      sy = Math.round(y + (height - winHeight) / 2);
      break;
    case 'right-center':
      sx = x + width - winWidth - SNAP_MARGIN;
      sy = Math.round(y + (height - winHeight) / 2);
      break;
    case 'bottom-right':
    default:
      sx = x + width - winWidth - SNAP_MARGIN;
      sy = y + height - winHeight - SNAP_MARGIN;
      break;
  }

  return { x: sx, y: sy };
}

function getWindowPosition(): { x: number; y: number } {
  const snap = getConfigValue('snapPosition') || 'bottom-right';
  return getSnapCoords(snap);
}

/** Determine the nearest snap slot from arbitrary pixel coordinates. Returns null if not near any edge. */
function detectSnapSlot(winX: number, winY: number, winWidth: number, winHeight: number): SnapPosition | null {
  const centerX = winX + winWidth / 2;
  const centerY = winY + winHeight / 2;
  const display = screen.getDisplayNearestPoint({ x: centerX, y: centerY });
  const area = display.workArea;

  const edgeThreshold = 80;
  const nearLeft = winX - area.x < edgeThreshold;
  const nearRight = (area.x + area.width) - (winX + winWidth) < edgeThreshold;
  const nearTop = winY - area.y < edgeThreshold;
  const nearBottom = (area.y + area.height) - (winY + winHeight) < edgeThreshold;

  // Must be near at least one edge
  if (!nearLeft && !nearRight && !nearTop && !nearBottom) return null;

  const midY = area.y + area.height / 2;
  const isCenterVertical = Math.abs(centerY - midY) < area.height * 0.2;

  if (nearLeft && isCenterVertical) return 'left-center';
  if (nearRight && isCenterVertical) return 'right-center';
  if (nearLeft && nearTop) return 'top-left';
  if (nearRight && nearTop) return 'top-right';
  if (nearLeft && nearBottom) return 'bottom-left';
  if (nearRight && nearBottom) return 'bottom-right';
  if (nearTop) return centerX < area.x + area.width / 2 ? 'top-left' : 'top-right';
  if (nearBottom) return centerX < area.x + area.width / 2 ? 'bottom-left' : 'bottom-right';
  if (nearLeft) return 'left-center';
  if (nearRight) return 'right-center';

  return null;
}

/** Snap the window to the nearest edge after a user drag. Only operates in collapsed mode. */
function handleWindowMoved(): void {
  if (!mainWindow || isExpanded || isSnapping) return;
  // Don't snap when pinned — allow free positioning
  if (getConfigValue('pinned')) return;

  const bounds = mainWindow.getBounds();
  const slot = detectSnapSlot(bounds.x, bounds.y, bounds.width, bounds.height);
  if (!slot) return;

  isSnapping = true;
  const coords = getSnapCoords(slot, bounds.width, bounds.height);
  mainWindow.setPosition(coords.x, coords.y, false);
  setConfigValue('snapPosition', slot);

  // Clear guard after animation
  setTimeout(() => { isSnapping = false; }, 300);
}

function toggleWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isVisible()) {
    // Let the renderer decide: navigate back to list or hide
    mainWindow.webContents.send('window:toggle');
  } else {
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const { x, y, width, height } = display.workArea;

    const snap = getConfigValue('snapPosition') || 'bottom-right';
    const isLeft = snap.includes('left');
    const winX = isLeft ? x + SNAP_MARGIN : x + width - WINDOW_WIDTH - SNAP_MARGIN;
    const winY = y + SNAP_MARGIN;
    const winHeight = height - SNAP_MARGIN * 2;

    showTimestamp = Date.now();
    mainWindow.setBounds({ x: winX, y: winY, width: WINDOW_WIDTH, height: winHeight }, false);
    mainWindow.setResizable(!!getConfigValue('pinned'));
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

  // Snap-on-drop: debounce move events so snap only fires after drag ends
  let snapDebounce: ReturnType<typeof setTimeout> | null = null;
  mainWindow.on('move', () => {
    if (snapDebounce) clearTimeout(snapDebounce);
    snapDebounce = setTimeout(handleWindowMoved, 500);
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

    const newX = Math.round(x + (width - EXPANDED_WIDTH) / 2);
    const newY = Math.round(y + (height - EXPANDED_HEIGHT) / 2);

    mainWindow.setAlwaysOnTop(false);
    mainWindow.setSkipTaskbar(false);
    mainWindow.setResizable(true);
    mainWindow.setBounds({ x: newX, y: newY, width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT }, true);
  });

  ipcMain.on('window:collapse', () => {
    if (!mainWindow || !isExpanded) return;
    isExpanded = false;

    mainWindow.setAlwaysOnTop(true);
    mainWindow.setSkipTaskbar(true);

    isSnapping = true;
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const { x, y, width, height } = display.workArea;

    const snap = getConfigValue('snapPosition') || 'bottom-right';
    const isLeft = snap.includes('left');
    const winX = isLeft ? x + SNAP_MARGIN : x + width - WINDOW_WIDTH - SNAP_MARGIN;
    const winY = y + SNAP_MARGIN;
    const winHeight = height - SNAP_MARGIN * 2;

    mainWindow.setBounds({ x: winX, y: winY, width: WINDOW_WIDTH, height: winHeight }, true);
    mainWindow.setResizable(!!getConfigValue('pinned'));
    setTimeout(() => { isSnapping = false; }, 300);
  });

  // ── Pin toggle ──────────────────────────────────────────
  ipcMain.handle('window:get-pinned', () => {
    return getConfigValue('pinned');
  });

  ipcMain.on('window:set-pinned', (_event, pinned: boolean) => {
    setConfigValue('pinned', pinned);
    if (mainWindow && !isExpanded) {
      mainWindow.setResizable(pinned);

      // When unpinning, snap back to full-height edge position
      if (!pinned) {
        const bounds = mainWindow.getBounds();
        const centerX = bounds.x + bounds.width / 2;
        const centerY = bounds.y + bounds.height / 2;
        const display = screen.getDisplayNearestPoint({ x: centerX, y: centerY });
        const area = display.workArea;

        const isLeft = centerX < area.x + area.width / 2;
        const snap: SnapPosition = isLeft ? 'top-left' : 'top-right';
        const winX = isLeft ? area.x + SNAP_MARGIN : area.x + area.width - WINDOW_WIDTH - SNAP_MARGIN;
        const winY = area.y + SNAP_MARGIN;
        const winHeight = area.height - SNAP_MARGIN * 2;

        setConfigValue('snapPosition', snap);
        mainWindow.setBounds({ x: winX, y: winY, width: WINDOW_WIDTH, height: winHeight }, false);
      }
    }
    // Notify all windows so UI can update
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('window:pinned-changed', pinned);
    }
  });
});

app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  await shutdownCopilot();
});

app.on('window-all-closed', () => {
  // Keep app running in tray — do nothing
});
