import { describe, expect, it, vi } from 'vitest';

vi.mock('../database', () => ({
  createSpace: vi.fn(),
  deleteAgentSession: vi.fn(),
  getSpace: vi.fn(),
  isInitialized: vi.fn(() => true),
  listSpaceEvents: vi.fn(() => []),
  listSpaces: vi.fn(() => [{ id: 'space-1', description: 'Test space' }]),
  searchSpaces: vi.fn(() => []),
}));

vi.mock('../ai', () => ({
  classifyInput: vi.fn(async () => ({ type: 'space' })),
  listAvailableModels: vi.fn(async () => []),
  resolveDateWithAI: vi.fn(async () => null),
}));

vi.mock('../config', () => ({
  DEFAULT_PERSONAS: [{ id: 'default-agent', handle: 'agent', instructions: 'help', model: '', runLocation: 'local' }],
  getConfigValue: vi.fn((key: string) => key === 'personas' ? [] : null),
}));

vi.mock('../workspace', () => ({
  materializeSpaceCanvas: vi.fn(),
  scheduleAutoCommit: vi.fn(),
}));

vi.mock('../services/space-processing', () => ({
  processSpaceInBackground: vi.fn(),
}));

vi.mock('../notify', () => ({
  notifyAllWindows: vi.fn(),
}));

import { GatewayError, invokeWebRemoteCommand, isAllowedWebRemoteCommand } from './gateway';

describe('web remote gateway', () => {
  it('allows only reviewed channels', () => {
    expect(isAllowedWebRemoteCommand('space:list')).toBe(true);
    expect(isAllowedWebRemoteCommand('chat:send-message')).toBe(true);
    expect(isAllowedWebRemoteCommand('settings:set')).toBe(false);
    expect(isAllowedWebRemoteCommand('shell:openExternal')).toBe(false);
  });

  it('allows canvas, agent-launch and git-sync channels', () => {
    for (const channel of [
      'canvas:read', 'canvas:write', 'canvas:close', 'canvas:history',
      'canvas:restore', 'canvas:list-pages', 'agent:launch', 'agent:list',
      'workspace:git-status', 'workspace:git-push', 'workspace:git-pull',
    ]) {
      expect(isAllowedWebRemoteCommand(channel)).toBe(true);
    }
    // Mutating workspace/settings channels remain denied.
    expect(isAllowedWebRemoteCommand('workspace:clear')).toBe(false);
    expect(isAllowedWebRemoteCommand('canvas:export')).toBe(false);
  });

  it('rejects denied channels before dispatch', async () => {
    await expect(invokeWebRemoteCommand('settings:set', ['cli_path', '/tmp/evil'])).rejects.toMatchObject({
      code: 'channel_not_allowed',
      status: 403,
    } satisfies Partial<GatewayError>);
  });

  it('dispatches allowed read channels', async () => {
    await expect(invokeWebRemoteCommand('space:list', [])).resolves.toEqual([
      { id: 'space-1', description: 'Test space' },
    ]);
  });
});
