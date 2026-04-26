import { BrowserWindow, screen, ipcMain } from 'electron';
import { getConfigValue, setConfigValue, type SnapPosition } from './config';

// ── Geometry constants ───────────────────────────────────
const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 520;
const EXPANDED_WIDTH = 720;
const EXPANDED_HEIGHT = 700;
const SNAP_MARGIN = 12;
const CANVAS_WIDTH = 780;
const CANVAS_HEIGHT = 700;

// ── Module state ─────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let canvasWindow: BrowserWindow | null = null;
let isExpanded = false;
let isSnapping = false;
let showTimestamp = 0;

// ── Public API ───────────────────────────────────────────

export interface WindowManagerOptions {
  preloadPath: string;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** Create and return the main BrowserWindow. Stores reference internally. */
export function createMainWindow(options: WindowManagerOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load via custom protocol so Web Speech API works (needs a real origin, not file://)
  win.loadURL('copilot-intent://app/renderer/index.html');
  attachBlurHide(win);

  mainWindow = win;
  return win;
}

/** Toggle the main window: show (full-height edge strip) or delegate hide to renderer. */
export function toggleWindow(): void {
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

/** Set up snap-on-drop: debounce move events so snap only fires after drag ends. */
export function setupSnapOnDrop(): void {
  if (!mainWindow) return;

  let snapDebounce: ReturnType<typeof setTimeout> | null = null;
  mainWindow.on('move', () => {
    if (snapDebounce) clearTimeout(snapDebounce);
    snapDebounce = setTimeout(handleWindowMoved, 500);
  });
}

/** Register all window-related IPC handlers. Call after createMainWindow(). */
export function registerWindowIpcHandlers(preloadPath: string): void {
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

    // Close canvas popout when unpinning
    if (!pinned && canvasWindow && !canvasWindow.isDestroyed()) {
      canvasWindow.close();
    }
  });

  // ── Canvas popout window ────────────────────────────────
  ipcMain.on('canvas-window:open', (_event, intentId: string, description: string) => {
    if (canvasWindow && !canvasWindow.isDestroyed()) {
      canvasWindow.webContents.send('canvas-window:load-intent', intentId, description);
      canvasWindow.focus();
    } else {
      canvasWindow = createCanvasWindow(preloadPath);
      canvasWindow.webContents.once('did-finish-load', () => {
        canvasWindow?.webContents.send('canvas-window:load-intent', intentId, description);
        canvasWindow?.show();
      });
    }
  });

  // Forward theme changes to canvas window
  ipcMain.on('canvas-window:theme-changed', (_event, theme: string) => {
    if (canvasWindow && !canvasWindow.isDestroyed()) {
      canvasWindow.webContents.send('canvas-window:theme-changed', theme);
    }
  });
}

// ── Internal helpers ─────────────────────────────────────

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

/** Determine the nearest snap slot from arbitrary pixel coordinates. */
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

function createCanvasWindow(preloadPath: string): BrowserWindow {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width, height } = display.workArea;

  const win = new BrowserWindow({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    x: Math.round(x + (width - CANVAS_WIDTH) / 2),
    y: Math.round(y + (height - CANVAS_HEIGHT) / 2),
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL('copilot-intent://app/renderer/index.html?mode=canvas');

  win.on('closed', () => {
    canvasWindow = null;
    mainWindow?.webContents.send('canvas-window:closed');
  });

  return win;
}
