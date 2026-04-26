import { BrowserWindow } from 'electron';

export function notifyAllWindows(channel: string, ...args: any[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}
