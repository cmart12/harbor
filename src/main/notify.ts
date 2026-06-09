import { BrowserWindow } from 'electron';
import { mirrorRendererEvent } from './web/event-hub';

export function notifyAllWindows(channel: string, ...args: any[]): void {
  mirrorRendererEvent(channel, ...args);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}
