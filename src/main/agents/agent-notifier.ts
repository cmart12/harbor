import { BrowserWindow, Notification } from 'electron';

export class AgentNotifier {
  /** Send an event to all renderer windows */
  notifyRenderer(channel: string, ...args: any[]): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, ...args);
    }
  }

  /** Show native OS notification for approval when window is unfocused */
  showApprovalNotification(agentId: string, permissionKind: string): void {
    const wins = BrowserWindow.getAllWindows();
    const anyFocused = wins.some(w => w.isFocused());
    if (anyFocused) return;

    const kindLabel = permissionKind
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

    const notification = new Notification({
      title: 'Approval needed',
      body: kindLabel || 'An agent needs your permission to continue',
      silent: false,
    });

    notification.on('click', () => {
      const win = wins[0];
      if (win) {
        win.show();
        win.focus();
        win.webContents.send('notification:approval-clicked', { agentId });
      }
    });

    notification.show();
  }
}
