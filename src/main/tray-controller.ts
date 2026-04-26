import { Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export interface TrayCallbacks {
  onToggleWindow: () => void;
  onQuit: () => void;
}

/** Create the system tray icon with context menu. */
export function createTray(callbacks: TrayCallbacks): Tray {
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

  const tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Intent — Quick Capture');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show', click: callbacks.onToggleWindow },
    { type: 'separator' },
    { label: 'Quit', click: callbacks.onQuit },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', callbacks.onToggleWindow);

  return tray;
}
