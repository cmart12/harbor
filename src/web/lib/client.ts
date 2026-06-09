import type { IpcCommandArgs, IpcCommandChannel, IpcCommandResult } from '../../shared/ipc-contract';
import type { WebRemoteEvent } from '../../main/web/event-hub';

export interface InvokeEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
}

export class WebRemoteClient {
  constructor(private readonly token: string) {}

  async invoke<C extends IpcCommandChannel>(
    channel: C,
    ...args: IpcCommandArgs<C>
  ): Promise<IpcCommandResult<C>> {
    const res = await fetch('/api/invoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify({ channel, args }),
    });
    const body = await res.json() as InvokeEnvelope<IpcCommandResult<C>>;
    if (!res.ok || !body.ok) {
      throw new Error(body.error?.message || `Request failed (${res.status})`);
    }
    return body.result as IpcCommandResult<C>;
  }

  connect(onEvent: (event: WebRemoteEvent) => void, onStatus: (status: string) => void): () => void {
    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer: number | null = null;

    const open = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/api/events?token=${encodeURIComponent(this.token)}`;
      ws = new WebSocket(url);
      ws.onopen = () => onStatus('live');
      ws.onclose = () => {
        onStatus('reconnecting');
        if (!closed) retryTimer = window.setTimeout(open, 1500);
      };
      ws.onerror = () => onStatus('connection error');
      ws.onmessage = (message) => {
        const data = JSON.parse(message.data);
        if (data?.type === 'event') onEvent(data.event);
      };
    };

    open();
    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }
}
