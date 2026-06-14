// Builds a compact, renderable chat transcript from agent history (raw SDK
// events) and live ChatEvents streamed over the web socket. Mirrors the desktop
// ChatView's parseHistoryEvents / event reducer, trimmed to what the mobile UI
// renders: user / assistant / tool / reasoning / event bubbles.
import type { ChatEvent } from '../../shared/chat-types';

export type Bubble =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'tool'; id: string; toolCallId: string; toolName: string; args: Record<string, unknown>; status: 'running' | 'done' | 'error'; result?: string }
  | { kind: 'event'; id: string; level: 'info' | 'error'; text: string };

let counter = 0;
function genId(): string {
  counter += 1;
  return `b${counter}-${Date.now()}`;
}

/** Convert persisted SDK history events into bubbles. */
export function parseHistory(events: unknown[]): Bubble[] {
  const bubbles: Bubble[] = [];
  const toolIndex = new Map<string, number>();

  for (const raw of events) {
    const event = raw as any;
    const type: string = event?.type || event?.kind || '';
    const data = event?.data || event || {};

    if (type === 'user.message' || type === 'user_message') {
      const text = data.content || data.prompt || data.message || '';
      if (text) bubbles.push({ kind: 'user', id: genId(), text });
    } else if (type === 'assistant.message' || type === 'assistant_message') {
      const text = data.content || data.message || '';
      if (text) bubbles.push({ kind: 'assistant', id: genId(), text, streaming: false });
    } else if (type === 'assistant.reasoning' || type === 'assistant_reasoning') {
      const text = data.content || '';
      if (text) bubbles.push({ kind: 'reasoning', id: genId(), text });
    } else if (type === 'tool.execution_start' || type === 'tool_execution_start') {
      const toolCallId = data.toolCallId || genId();
      toolIndex.set(toolCallId, bubbles.length);
      bubbles.push({
        kind: 'tool', id: genId(), toolCallId,
        toolName: data.toolName || 'tool',
        args: data.arguments || data.toolArgs || {},
        status: 'running',
      });
    } else if (type === 'tool.execution_complete' || type === 'tool_execution_complete') {
      const toolCallId = data.toolCallId || '';
      const idx = toolIndex.get(toolCallId);
      if (idx !== undefined && bubbles[idx]?.kind === 'tool') {
        const b = bubbles[idx] as Extract<Bubble, { kind: 'tool' }>;
        const rawResult = data.result;
        b.result = typeof rawResult === 'string' ? rawResult : rawResult?.detailedContent ?? rawResult?.content ?? '';
        b.status = data.success === false ? 'error' : 'done';
      }
    } else if (type === 'session.error' || type === 'session_error') {
      bubbles.push({ kind: 'event', id: genId(), level: 'error', text: data.message || 'Session error' });
    }
  }
  return bubbles;
}

/** Fold a single live ChatEvent into the transcript, returning a new array. */
export function applyChatEvent(bubbles: Bubble[], event: ChatEvent): Bubble[] {
  switch (event.type) {
    case 'assistant.message_delta': {
      const last = bubbles[bubbles.length - 1];
      if (last && last.kind === 'assistant' && last.streaming) {
        const next = bubbles.slice();
        next[next.length - 1] = { ...last, text: last.text + event.delta };
        return next;
      }
      return [...bubbles, { kind: 'assistant', id: genId(), text: event.delta, streaming: true }];
    }
    case 'assistant.message': {
      const last = bubbles[bubbles.length - 1];
      if (last && last.kind === 'assistant' && last.streaming) {
        const next = bubbles.slice();
        next[next.length - 1] = { ...last, text: event.content || last.text, streaming: false };
        return next;
      }
      if (!event.content) return bubbles;
      return [...bubbles, { kind: 'assistant', id: genId(), text: event.content, streaming: false }];
    }
    case 'tool.start':
      return [...bubbles, {
        kind: 'tool', id: genId(), toolCallId: event.toolCallId,
        toolName: event.toolName, args: event.args || {}, status: 'running',
      }];
    case 'tool.complete':
      return bubbles.map((b) =>
        b.kind === 'tool' && b.toolCallId === event.toolCallId
          ? { ...b, status: event.success ? 'done' : 'error', result: event.result }
          : b,
      );
    case 'session.error':
      return [...bubbles, { kind: 'event', id: genId(), level: 'error', text: event.message || 'Session error' }];
    case 'session.restarted':
      return [...bubbles, { kind: 'event', id: genId(), level: 'info', text: event.message || 'Session restarted with prior context.' }];
    default:
      return bubbles;
  }
}

export function applyChatEvents(bubbles: Bubble[], events: ChatEvent[]): Bubble[] {
  return events.reduce((next, event) => applyChatEvent(next, event), bubbles);
}
