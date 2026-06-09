import { EventEmitter } from 'events';

export interface WebRemoteEvent {
  channel: string;
  payload: unknown;
  timestamp: string;
}

const ALLOWED_EVENT_CHANNELS = new Set([
  'chat:event',
  'agent:status-changed',
  'agent:completed',
  'agent:approval-needed',
  'agent:sandbox-blocked',
  'agent:sandbox-resolved',
  'space:processed',
  'space:recurrence-applied',
]);

const hub = new EventEmitter();

function normalizeEvent(channel: string, args: unknown[]): WebRemoteEvent | null {
  if (channel.startsWith('chat:event:')) {
    const agentId = channel.slice('chat:event:'.length);
    const data = args[0];
    const payload = data && typeof data === 'object'
      ? { agentId, ...(data as Record<string, unknown>) }
      : { agentId, data };
    return { channel: 'chat:event', payload, timestamp: new Date().toISOString() };
  }

  if (!ALLOWED_EVENT_CHANNELS.has(channel)) return null;

  if (channel === 'space:processed' || channel === 'space:recurrence-applied') {
    return {
      channel,
      payload: { spaceId: args[0] },
      timestamp: new Date().toISOString(),
    };
  }

  return {
    channel,
    payload: args.length <= 1 ? args[0] ?? null : args,
    timestamp: new Date().toISOString(),
  };
}

export function mirrorRendererEvent(channel: string, ...args: unknown[]): void {
  const event = normalizeEvent(channel, args);
  if (!event) return;
  hub.emit('event', event);
}

export function subscribeWebRemoteEvents(callback: (event: WebRemoteEvent) => void): () => void {
  hub.on('event', callback);
  return () => hub.off('event', callback);
}

export function isWebRemoteEventAllowed(channel: string): boolean {
  return channel.startsWith('chat:event:') || ALLOWED_EVENT_CHANNELS.has(channel);
}
