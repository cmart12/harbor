import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

const { setPathSpy } = vi.hoisted(() => ({ setPathSpy: vi.fn() }));

// Mock electron so importing app-paths exercises its side effect without a real
// app instance. getPath('appData') returns a fixed root; setPath is a spy.
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'appData' ? '/mock/appData' : '/mock/other'),
    setPath: setPathSpy,
  },
}));

// Avoid touching the real filesystem when app-paths ensures the dir exists.
vi.mock('fs', () => ({ mkdirSync: vi.fn() }));

describe('app-paths', () => {
  beforeEach(() => {
    setPathSpy.mockClear();
    vi.resetModules();
  });

  it('pins userData to <appData>/whim, independent of productName', async () => {
    await import('./app-paths');
    expect(setPathSpy).toHaveBeenCalledWith('userData', path.join('/mock/appData', 'whim'));
  });

  it('exposes the canonical user-data dir name', async () => {
    const mod = await import('./app-paths');
    expect(mod.USER_DATA_DIR_NAME).toBe('whim');
  });
});
