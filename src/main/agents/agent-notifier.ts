import { BrowserWindow, Notification } from 'electron';

export interface ApprovalNotificationOptions {
  agentId: string;
  requestId: string;
  permissionKind: string;
  intention?: string;
  path?: string;
  onApprove?: () => void;
  onDeny?: () => void;
}

export class AgentNotifier {
  /** Send an event to all renderer windows */
  notifyRenderer(channel: string, ...args: any[]): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, ...args);
    }
  }

  /** Show native OS notification for approval when window is unfocused */
  showApprovalNotification(options: ApprovalNotificationOptions): void {
    const wins = BrowserWindow.getAllWindows();
    const anyFocused = wins.some(w => w.isFocused());
    if (anyFocused) return;

    const { agentId, permissionKind, intention, path, onApprove, onDeny } = options;

    const kindLabel = permissionKind
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

    const bodyParts: string[] = [kindLabel || 'An agent needs your permission to continue'];
    if (intention) bodyParts.push(intention);
    if (path) bodyParts.push(path);

    const notification = new Notification({
      title: 'Approval needed',
      body: bodyParts.join('\n'),
      silent: false,
      actions: [
        { type: 'button', text: 'Approve' },
        { type: 'button', text: 'Deny' },
      ],
    });

    notification.on('action', (_event, index) => {
      if (index === 0) {
        onApprove?.();
      } else {
        onDeny?.();
      }
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
