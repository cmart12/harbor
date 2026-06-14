import { describe, expect, it, vi } from 'vitest';
import { mirrorRendererEvent, subscribeWebRemoteEvents } from './event-hub';

describe('web remote event hub', () => {
  it('normalizes dynamic chat channels', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeWebRemoteEvents(callback);

    mirrorRendererEvent('chat:event:agent-1', { type: 'assistant.message', content: 'hi' });
    unsubscribe();

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'chat:event',
      payload: { agentId: 'agent-1', type: 'assistant.message', content: 'hi' },
    }));
  });

  it('normalizes space event payloads', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeWebRemoteEvents(callback);

    mirrorRendererEvent('space:processed', 'space-1');
    unsubscribe();

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'space:processed',
      payload: { spaceId: 'space-1' },
    }));
  });

  it('mirrors canvas + git sync events for live updates', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeWebRemoteEvents(callback);

    mirrorRendererEvent('canvas:content-updated', { spaceId: 'space-1', content: '# hi' });
    mirrorRendererEvent('workspace:git-sync-changed', { available: true, branch: 'main', ahead: 1, behind: 0 });
    mirrorRendererEvent('workspace:committed');
    unsubscribe();

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'canvas:content-updated',
      payload: { spaceId: 'space-1', content: '# hi' },
    }));
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'workspace:git-sync-changed',
      payload: { available: true, branch: 'main', ahead: 1, behind: 0 },
    }));
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ channel: 'workspace:committed' }));
  });

  it('does not emit disallowed renderer events', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeWebRemoteEvents(callback);

    mirrorRendererEvent('settings:changed', { unsafe: true });
    unsubscribe();

    expect(callback).not.toHaveBeenCalled();
  });
});
