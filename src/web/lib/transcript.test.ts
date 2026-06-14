import { describe, expect, it } from 'vitest';
import { applyChatEvent, parseHistory, type Bubble } from './transcript';

describe('parseHistory', () => {
  it('builds user, assistant and tool bubbles from SDK events', () => {
    const bubbles = parseHistory([
      { type: 'user.message', data: { content: 'do it' } },
      { type: 'tool.execution_start', data: { toolCallId: 't1', toolName: 'bash', arguments: { command: 'ls' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 't1', result: 'ok', success: true } },
      { type: 'assistant.message', data: { content: 'done' } },
    ]);

    expect(bubbles.map((b) => b.kind)).toEqual(['user', 'tool', 'assistant']);
    const tool = bubbles.find((b) => b.kind === 'tool') as Extract<Bubble, { kind: 'tool' }>;
    expect(tool.status).toBe('done');
    expect(tool.result).toBe('ok');
  });

  it('marks failed tools as error', () => {
    const bubbles = parseHistory([
      { type: 'tool.execution_start', data: { toolCallId: 't1', toolName: 'bash' } },
      { type: 'tool.execution_complete', data: { toolCallId: 't1', result: 'boom', success: false } },
    ]);
    const tool = bubbles[0] as Extract<Bubble, { kind: 'tool' }>;
    expect(tool.status).toBe('error');
  });
});

describe('applyChatEvent', () => {
  it('accumulates streaming assistant deltas then finalizes', () => {
    let bubbles: Bubble[] = [];
    bubbles = applyChatEvent(bubbles, { type: 'assistant.message_delta', delta: 'Hel' });
    bubbles = applyChatEvent(bubbles, { type: 'assistant.message_delta', delta: 'lo' });
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toMatchObject({ kind: 'assistant', text: 'Hello', streaming: true });

    bubbles = applyChatEvent(bubbles, { type: 'assistant.message', content: 'Hello world' });
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toMatchObject({ kind: 'assistant', text: 'Hello world', streaming: false });
  });

  it('adds and completes a tool bubble', () => {
    let bubbles: Bubble[] = [];
    bubbles = applyChatEvent(bubbles, { type: 'tool.start', toolCallId: 'x', toolName: 'edit', args: { path: '/a.ts' } });
    bubbles = applyChatEvent(bubbles, { type: 'tool.complete', toolCallId: 'x', result: 'r', success: true });
    const tool = bubbles[0] as Extract<Bubble, { kind: 'tool' }>;
    expect(tool.status).toBe('done');
  });

  it('appends an error event for session errors', () => {
    const bubbles = applyChatEvent([], { type: 'session.error', message: 'nope' });
    expect(bubbles[0]).toMatchObject({ kind: 'event', level: 'error', text: 'nope' });
  });
});
