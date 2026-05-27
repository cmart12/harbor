import { BrowserWindow, screen, ipcMain, shell } from 'electron';
import { getConfigValue, setConfigValue, type SnapPosition } from './config';
import * as fs from 'fs';
import * as nodePath from 'path';

// ── Geometry constants ───────────────────────────────────
const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 520;
const EXPANDED_WIDTH = 720;
const EXPANDED_HEIGHT = 700;
const SNAP_MARGIN = 12;
const CANVAS_WIDTH = 780;
const CANVAS_HEIGHT = 700;

// ── Geometry constants (settings window) ─────────────────
const SETTINGS_WIDTH = 720;
const SETTINGS_HEIGHT = 700;

// ── Module state ─────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let canvasWindow: BrowserWindow | null = null;
const canvasWindows = new Set<BrowserWindow>();
const canvasUserPinned = new WeakSet<BrowserWindow>();
let settingsWindow: BrowserWindow | null = null;
let settingsWindowAllowClose = false;
let isExpanded = false;
let isSnapping = false;
let showTimestamp = 0;
let unpinTimestamp = 0;
let blurHideTimer: ReturnType<typeof setTimeout> | null = null;
let storedPreloadPath: string = '';

// ── Window stacking policy ──────────────────────────────
// Centralized helpers so every callsite agrees on when a window is alwaysOnTop.

function shouldMainBeOnTop(): boolean {
  return getConfigValue('pinned') || getConfigValue('autoHideSidePane');
}

function shouldBlurHide(): boolean {
  return getConfigValue('autoHideSidePane') && !getConfigValue('pinned');
}

function shouldCanvasBeOnTop(win: BrowserWindow): boolean {
  return getConfigValue('pinned') || canvasUserPinned.has(win);
}

/** Apply the stacking policy to the main window and all canvas windows. */
function applyStackingPolicy(): void {
  if (mainWindow && !mainWindow.isDestroyed() && !isExpanded) {
    mainWindow.setAlwaysOnTop(shouldMainBeOnTop());
  }
  for (const win of canvasWindows) {
    if (!win.isDestroyed()) {
      win.setAlwaysOnTop(shouldCanvasBeOnTop(win));
    }
  }
}

function cancelBlurTimer(): void {
  if (blurHideTimer) { clearTimeout(blurHideTimer); blurHideTimer = null; }
}

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
    resizable: true,
    alwaysOnTop: shouldMainBeOnTop(),
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
  win.loadURL('copilot-whim://app/renderer/index.html');
  attachBlurHide(win);
  attachResizePersist(win);
  attachExternalLinkHandler(win);

  mainWindow = win;

  return win;
}

/** Called when the autoHideSidePane setting changes at runtime. */
export function onAutoHideSidePaneChanged(): void {
  cancelBlurTimer();
  applyStackingPolicy();
}

/** Toggle the main window: show (full-height edge strip) or delegate hide to renderer. */
export function toggleWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const autoHide = getConfigValue('autoHideSidePane');

  if (!autoHide) {
    // Non-auto-hide mode: toggle the window visibility
    if (mainWindow.isVisible()) {
      if (mainWindow.isFocused()) {
        // Visible and focused — hide via renderer slide-out
        mainWindow.webContents.send('window:toggle');
      } else {
        // Visible but behind other windows — bring to front
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    } else {
      const cursorPoint = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(cursorPoint);
      const { x, y, width, height } = display.workArea;

      const snap = getConfigValue('snapPosition') || 'bottom-right';
      const isLeft = snap.includes('left');
      const winWidth = getConfigValue('windowWidth') || WINDOW_WIDTH;
      const winX = isLeft ? x + SNAP_MARGIN : x + width - winWidth - SNAP_MARGIN;
      const winY = y + SNAP_MARGIN;
      const winHeight = height - SNAP_MARGIN * 2;

      mainWindow.setBounds({ x: winX, y: winY, width: winWidth, height: winHeight }, false);
      mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.send('window:shown', { side: isLeft ? 'left' : 'right', expanded: false });
    }
    return;
  }

  if (mainWindow.isVisible()) {
    // Let the renderer decide: navigate back to list or hide
    mainWindow.webContents.send('window:toggle');
  } else {
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const { x, y, width, height } = display.workArea;

    const snap = getConfigValue('snapPosition') || 'bottom-right';
    const isLeft = snap.includes('left');
    const winWidth = getConfigValue('windowWidth') || WINDOW_WIDTH;
    const winX = isLeft ? x + SNAP_MARGIN : x + width - winWidth - SNAP_MARGIN;
    const winY = y + SNAP_MARGIN;
    const winHeight = height - SNAP_MARGIN * 2;

    showTimestamp = Date.now();
    cancelBlurTimer();
    mainWindow.setBounds({ x: winX, y: winY, width: winWidth, height: winHeight }, false);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('window:shown', { side: isLeft ? 'left' : 'right', expanded: false });
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
  storedPreloadPath = preloadPath;

  ipcMain.on('window:hide', () => {
    cancelBlurTimer();
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

    mainWindow.setAlwaysOnTop(false);  // expanded windows are never alwaysOnTop
    mainWindow.setResizable(true);
    mainWindow.setBounds({ x: newX, y: newY, width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT }, true);
  });

  ipcMain.on('window:collapse', () => {
    if (!mainWindow || !isExpanded) return;
    isExpanded = false;

    mainWindow.setAlwaysOnTop(shouldMainBeOnTop());

    isSnapping = true;
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const { x, y, width, height } = display.workArea;

    const snap = getConfigValue('snapPosition') || 'bottom-right';
    const isLeft = snap.includes('left');
    const winWidth = getConfigValue('windowWidth') || WINDOW_WIDTH;
    const winX = isLeft ? x + SNAP_MARGIN : x + width - winWidth - SNAP_MARGIN;
    const winY = y + SNAP_MARGIN;
    const winHeight = height - SNAP_MARGIN * 2;

    mainWindow.setBounds({ x: winX, y: winY, width: winWidth, height: winHeight }, true);
    setTimeout(() => { isSnapping = false; }, 300);
  });

  // ── Pin toggle ──────────────────────────────────────────
  ipcMain.handle('window:get-pinned', () => {
    return getConfigValue('pinned');
  });

  ipcMain.on('window:set-pinned', (_event, pinned: boolean) => {
    setConfigValue('pinned', pinned);
    cancelBlurTimer();
    applyStackingPolicy();

    if (mainWindow && !isExpanded) {
      // When unpinning, snap back to full-height edge position
      if (!pinned) {
        unpinTimestamp = Date.now();
        isSnapping = true;

        const bounds = mainWindow.getBounds();
        const centerX = bounds.x + bounds.width / 2;
        const centerY = bounds.y + bounds.height / 2;
        const display = screen.getDisplayNearestPoint({ x: centerX, y: centerY });
        const area = display.workArea;

        const isLeft = centerX < area.x + area.width / 2;
        const snap: SnapPosition = isLeft ? 'top-left' : 'top-right';
        const winWidth = getConfigValue('windowWidth') || WINDOW_WIDTH;
        const winX = isLeft ? area.x + SNAP_MARGIN : area.x + area.width - winWidth - SNAP_MARGIN;
        const winY = area.y + SNAP_MARGIN;
        const winHeight = area.height - SNAP_MARGIN * 2;

        setConfigValue('snapPosition', snap);
        mainWindow.setBounds({ x: winX, y: winY, width: winWidth, height: winHeight }, false);
        setTimeout(() => { isSnapping = false; }, 500);
      }
    }
    // Notify all windows so UI can update
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('window:pinned-changed', pinned);
    }
  });

  // ── Canvas popout window ────────────────────────────────
  ipcMain.on('canvas-window:open', (_event, target: { kind: string; id: string; title: string }) => {
    if (canvasWindow && !canvasWindow.isDestroyed()) {
      canvasWindow.webContents.send('canvas-window:load-target', target);
      canvasWindow.focus();
    } else {
      canvasWindow = createCanvasWindow(preloadPath);
      canvasWindow.webContents.once('did-finish-load', () => {
        canvasWindow?.webContents.send('canvas-window:load-target', target);
        canvasWindow?.show();
      });
    }
  });

  // Open a new canvas window (even if one already exists)
  ipcMain.on('canvas-window:open-new', (_event, target: { kind: string; id: string; title: string }) => {
    const win = createCanvasWindow(preloadPath);
    // Track as the "primary" canvas for default reuse
    canvasWindow = win;
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('canvas-window:load-target', target);
      win.show();
    });
  });

  // Open a child page in a new canvas window
  ipcMain.on('canvas-window:open-page', (_event, target: { kind: 'page'; spaceId: string; page: string; title: string }) => {
    openPageInNewWindow(preloadPath, target.spaceId, target.page);
  });

  // Toggle user-pinned state for the calling canvas window.
  // When the side pane is pinned all canvases are already alwaysOnTop;
  // per-canvas pin gives the user independent control.
  ipcMain.on('canvas-window:set-always-on-top', (event, pinned: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      if (pinned) {
        canvasUserPinned.add(win);
      } else {
        canvasUserPinned.delete(win);
      }
      win.setAlwaysOnTop(shouldCanvasBeOnTop(win));
    }
  });

  ipcMain.handle('canvas-window:get-always-on-top', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      return canvasUserPinned.has(win);
    }
    return false;
  });

  // Forward theme changes to all windows
  ipcMain.on('canvas-window:theme-changed', (_event, theme: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('canvas-window:theme-changed', theme);
    }
    for (const win of canvasWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('canvas-window:theme-changed', theme);
      }
    }
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('canvas-window:theme-changed', theme);
    }
  });

  // ── Settings popout window ─────────────────────────────
  ipcMain.on('settings-window:open', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      if (!settingsWindow.isVisible()) settingsWindow.show();
      settingsWindow.focus();
    } else {
      settingsWindow = createSettingsWindow(preloadPath);
      settingsWindow.once('ready-to-show', () => {
        settingsWindow?.show();
      });
    }
  });

  // ── Cross-window agent chat ────────────────────────────
  // Canvas window requests opening an agent chat in the main panel
  ipcMain.on('main-window:open-agent-chat', (_event, data: { agentId: string; agentPrompt: string; agentStatus: string; agentSource?: 'sdk' | 'cli'; spaceId?: string }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // Show the main window if hidden
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();

    mainWindow.webContents.send('main-window:open-agent-chat', data);
  });

  // Canvas window requests opening the persona sandbox editor in the main panel.
  // Used by canvas worker-tile sandbox-block panels so the user can edit the
  // sandbox policy for the persona that launched the blocked agent without
  // leaving the demo flow. Targeted send only — no broadcast.
  ipcMain.on('main-window:open-persona-sandbox-editor', (_event, data: { personaHandle: string }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
    mainWindow.webContents.send('main-window:open-persona-sandbox-editor', data);
  });
}

// ── Internal helpers ─────────────────────────────────────

/** Open external links in the user's default browser instead of inside Electron. */
function attachExternalLinkHandler(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('whim://page/')) {
      const parts = decodeURIComponent(url.replace('whim://page/', '')).split('/');
      if (parts.length >= 2) {
        const [spaceId, ...rest] = parts;
        const page = rest.join('/');
        openPageInNewWindow(storedPreloadPath, spaceId, page);
      }
    } else if (url.startsWith('whim://space/')) {
      const spaceId = url.replace('whim://space/', '');
      navigateCanvasToSpace(win, spaceId);
    } else if (url.startsWith('file://')) {
      handleFileUrl(url);
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('whim://page/')) {
      event.preventDefault();
      const parts = decodeURIComponent(url.replace('whim://page/', '')).split('/');
      if (parts.length >= 2) {
        const [spaceId, ...rest] = parts;
        const page = rest.join('/');
        openPageInNewWindow(storedPreloadPath, spaceId, page);
      }
    } else if (url.startsWith('whim://space/')) {
      event.preventDefault();
      const spaceId = url.replace('whim://space/', '');
      navigateCanvasToSpace(win, spaceId);
    } else if (url.startsWith('file://')) {
      event.preventDefault();
      handleFileUrl(url);
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

/** Handle a file:// URL — open .md files under workspace in canvas, others externally. */
function handleFileUrl(url: string): void {
  try {
    const filePath = decodeURIComponent(new URL(url).pathname);
    if (isWorkspaceMdFile(filePath)) {
      openFileInNewWindow(filePath);
    } else {
      shell.openPath(filePath);
    }
  } catch {
    // Malformed URL — ignore
  }
}

/** Check if a file path is a .md file that lives inside the workspace root. */
export function isWorkspaceMdFile(filePath: string): boolean {
  const workspace = getConfigValue('workspace');
  if (!workspace) return false;
  if (!filePath.toLowerCase().endsWith('.md')) return false;

  try {
    const realWorkspace = fs.realpathSync(workspace) + nodePath.sep;
    const realFile = fs.realpathSync(filePath);
    return realFile.startsWith(realWorkspace);
  } catch {
    // File doesn't exist or can't resolve — not a workspace md file
    return false;
  }
}

/** Navigate a canvas window to a different space by sending a load-target event. */
function navigateCanvasToSpace(win: BrowserWindow, spaceId: string): void {
  if (!win.isDestroyed()) {
    win.webContents.send('canvas-window:load-target', { kind: 'space', id: spaceId, title: '' });
  }
}

/** Open a child page in a new canvas window. */
function openPageInNewWindow(preloadPath: string, spaceId: string, page: string): void {
  const win = createCanvasWindow(preloadPath);
  const target = { kind: 'page' as const, spaceId, page, title: page };
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('canvas-window:load-target', target);
    win.show();
  });
}

/** Open a workspace .md file in a new canvas window. */
export function openFileInNewWindow(filePath: string): void {
  const title = filePath.split('/').pop()?.replace(/\.md$/i, '') ?? filePath;
  const win = createCanvasWindow(storedPreloadPath);
  const target = { kind: 'file' as const, filePath, title };
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('canvas-window:load-target', target);
    win.show();
  });
}

/** Persist the user's preferred width when they resize the window. */
function attachResizePersist(win: BrowserWindow): void {
  let resizeDebounce: ReturnType<typeof setTimeout> | null = null;
  win.on('resize', () => {
    if (isExpanded || isSnapping) return;
    if (resizeDebounce) clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      if (!win.isDestroyed()) {
        const { width } = win.getBounds();
        setConfigValue('windowWidth', width);
      }
    }, 300);
  });
}

/** Attach blur handler that lets the renderer animate out before hiding. */
function attachBlurHide(win: BrowserWindow): void {
  win.on('blur', () => {
    // Only auto-hide when the policy says so
    if (!shouldBlurHide()) return;

    // Ignore blur if window was just shown (e.g. from tray menu click)
    if (Date.now() - showTimestamp < 300) return;

    // Ignore blur caused by setBounds repositioning after unpin
    if (Date.now() - unpinTimestamp < 500) return;

    // Let renderer decide whether to stay and animate out if hiding
    win.webContents.send('window:request-hide');

    // Safety: hide even if renderer doesn't respond in time
    cancelBlurTimer();
    blurHideTimer = setTimeout(() => {
      // Re-check policy in case it changed during the delay
      if (!shouldBlurHide()) { blurHideTimer = null; return; }
      if (!win.isDestroyed() && win.isVisible()) win.hide();
      blurHideTimer = null;
    }, 400);
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
    alwaysOnTop: getConfigValue('pinned'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 20 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL('copilot-whim://app/renderer/index.html?mode=canvas');
  attachExternalLinkHandler(win);

  canvasWindows.add(win);
  win.on('closed', () => {
    canvasWindows.delete(win);
    if (canvasWindow === win) canvasWindow = null;
    mainWindow?.webContents.send('canvas-window:closed');
  });

  return win;
}

function createSettingsWindow(preloadPath: string): BrowserWindow {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width, height } = display.workArea;

  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: SETTINGS_WIDTH,
    height: SETTINGS_HEIGHT,
    x: Math.round(x + (width - SETTINGS_WIDTH) / 2),
    y: Math.round(y + (height - SETTINGS_HEIGHT) / 2),
    show: false,
    alwaysOnTop: true,
    title: 'Settings',
    // macOS: hidden inset title bar; Windows/Linux: frameless
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 20 } }
      : { frame: false }),
    autoHideMenuBar: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL('copilot-whim://app/renderer/index.html?mode=settings');
  attachExternalLinkHandler(win);

  // Hide instead of destroy so subsequent opens are instant. The renderer
  // process stays alive in the background; only an explicit `destroy()`
  // (during app quit, see `releaseSettingsWindow`) actually closes it.
  win.on('close', (event) => {
    if (settingsWindowAllowClose) return;
    if (win.isDestroyed()) return;
    event.preventDefault();
    win.hide();
  });

  win.on('closed', () => {
    settingsWindow = null;
  });

  return win;
}

/**
 * Pre-warm the settings window at app start so the first open is instant.
 * Creates the window hidden; the renderer process and bundle load happen
 * in the background. No-op if a settings window already exists.
 */
export function preWarmSettingsWindow(preloadPath: string): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) return;
  settingsWindow = createSettingsWindow(preloadPath);
}

/**
 * Allow the settings window to actually close (used during app quit so the
 * hide-on-close interceptor doesn't prevent shutdown). After this is
 * called, subsequent close events on the settings window will close it
 * normally. Safe to call multiple times.
 */
export function releaseSettingsWindow(): void {
  settingsWindowAllowClose = true;
}

/**
 * Destroy the (possibly hidden) settings window. Use this when the
 * underlying data the settings window depends on has changed in a way
 * that the cached renderer state can't recover from (e.g. workspace
 * switch) — the next `settings-window:open` will cold-start a fresh
 * renderer with up-to-date data.
 */
export function destroySettingsWindow(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = null;
    return;
  }
  const win = settingsWindow;
  settingsWindowAllowClose = true;
  try {
    win.destroy();
  } finally {
    // Reset the flag — future settings windows should hide on close,
    // not destroy, until `releaseSettingsWindow()` is called again.
    settingsWindowAllowClose = false;
    settingsWindow = null;
  }
}
