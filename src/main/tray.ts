import { Tray, Menu, nativeImage, app } from 'electron';
import * as path from 'path';
import { toggleWindow } from './window-manager';

let tray: Tray | null = null;

function getIconPath(): string {
  const iconName = process.platform === 'win32' ? 'tray-icon-16.png' : 'tray-icon.png';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', iconName);
  }
  // Dev mode: assets are in src/assets relative to project root
  return path.join(__dirname, '..', '..', 'src', 'assets', iconName);
}

/** Create and show the system tray icon. Call once after app is ready. */
export function createTray(): void {
  const icon = nativeImage.createFromPath(getIconPath());
  // On macOS, mark as template so it adapts to dark/light menu bar
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip('Mona');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show/Hide', click: () => toggleWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => toggleWindow());
}

/** Destroy the tray icon (called on app quit). */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
