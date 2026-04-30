import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ── Capture handlers registered via ipcMain.handle / ipcMain.on ─────
const handleHandlers = new Map<string, Function>();
const onHandlers = new Map<string, Function>();

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/space-test' },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handleHandlers.set(channel, handler);
    }),
    on: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => mockWindows,
    fromWebContents: () => null,
  },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn(() => true) };
});

vi.mock('../database', () => ({
  isInitialized: vi.fn(() => true),
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  mergeSessionIds: vi.fn(),
  syncCanvasContent: vi.fn(),
}));

vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({ workspace: '/mock/workspace', sessions: {} })),
  getConfigValue: vi.fn((key: string) => {
    if (key === 'workspace') return '/mock/workspace';
    return null;
  }),
  setConfigValue: vi.fn(),
}));

vi.mock('../workspace', () => ({
  initWorkspace: vi.fn(),
  getDbPath: vi.fn((dir: string) => `${dir}/.whim/spaces.db`),
  getLogPath: vi.fn((dir: string) => `${dir}/.whim/events.jsonl`),
}));

vi.mock('../skill-watcher', () => ({
  startSkillWatcher: vi.fn(),
  stopSkillWatcher: vi.fn(),
}));

vi.mock('../session', () => ({
  launchSession: vi.fn(async () => ({ success: true })),
  getActiveSessionIntentIds: vi.fn(() => []),
}));

vi.mock('../voice', () => ({
  transcribeAudio: vi.fn(async () => 'transcribed text'),
}));

// ── Import after mocks ─────────────────────────────────────────────
import { registerWorkspaceHandlers } from '../../main/ipc/workspace-handlers';
import { closeDatabase, initDatabase, mergeSessionIds, syncCanvasContent } from '../database';
import { setConfigValue, getConfig } from '../config';
import { initWorkspace } from '../workspace';
import { startSkillWatcher, stopSkillWatcher } from '../skill-watcher';
import { dialog, BrowserWindow } from 'electron';

const fakeEvent = { sender: { id: 1 } } as any;

// Track webContents.send calls per window
const mockSend = vi.fn();
const mockWindows = [{ webContents: { send: mockSend } }];

function invoke(channel: string, ...args: any[]) {
  const handler = handleHandlers.get(channel);
  if (!handler) throw new Error(`No handler registered for "${channel}"`);
  return handler(fakeEvent, ...args);
}

describe('workspace handlers', () => {
  beforeAll(() => {
    registerWorkspaceHandlers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('workspace:clear', () => {
    it('stops skill watcher', async () => {
      await invoke('workspace:clear');
      expect(stopSkillWatcher).toHaveBeenCalled();
    });

    it('closes the database', async () => {
      await invoke('workspace:clear');
      expect(closeDatabase).toHaveBeenCalled();
    });

    it('clears workspace config', async () => {
      await invoke('workspace:clear');
      expect(setConfigValue).toHaveBeenCalledWith('workspace', null);
    });

    it('sends workspace:changed with null to all windows', async () => {
      await invoke('workspace:clear');
      expect(mockSend).toHaveBeenCalledWith('workspace:changed', null);
    });

    it('returns ok', async () => {
      const result = await invoke('workspace:clear');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('workspace:select', () => {
    it('closes old DB before initializing new workspace', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/new/workspace'],
      } as any);

      const callOrder: string[] = [];
      vi.mocked(stopSkillWatcher).mockImplementation(() => { callOrder.push('stop'); });
      vi.mocked(closeDatabase).mockImplementation(() => { callOrder.push('close'); });
      vi.mocked(initWorkspace).mockImplementation(() => { callOrder.push('init-ws'); });
      vi.mocked(initDatabase).mockImplementation(() => { callOrder.push('init-db'); });

      await invoke('workspace:select');

      expect(callOrder).toEqual(['stop', 'close', 'init-ws', 'init-db']);
    });

    it('sends workspace:changed event after selection', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/new/workspace'],
      } as any);

      await invoke('workspace:select');

      expect(mockSend).toHaveBeenCalledWith('workspace:changed', '/new/workspace');
    });

    it('saves workspace to config', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/new/workspace'],
      } as any);

      await invoke('workspace:select');

      expect(setConfigValue).toHaveBeenCalledWith('workspace', '/new/workspace');
    });

    it('starts skill watcher for new workspace', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/new/workspace'],
      } as any);

      await invoke('workspace:select');

      expect(startSkillWatcher).toHaveBeenCalledWith('/new/workspace');
    });

    it('returns selected: false when dialog is canceled', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: true,
        filePaths: [],
      } as any);

      const result = await invoke('workspace:select');

      expect(result).toEqual({ selected: false, path: null });
      expect(closeDatabase).not.toHaveBeenCalled();
    });
  });
});
