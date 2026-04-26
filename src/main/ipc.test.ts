import { describe, it, expect, vi, beforeAll } from 'vitest';

// ── Capture handlers registered via ipcMain.handle ──────────────────
const handlers = new Map<string, Function>();

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/intent-test' },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler);
    }),
  },
  BrowserWindow: {
    getAllWindows: () => [],
    fromWebContents: () => null,
  },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn(() => true) };
});

vi.mock('./database', () => ({
  isInitialized: vi.fn(() => true),
  createIntent: vi.fn((input: any) => ({
    id: 'intent-1',
    ...input,
    status: 'captured',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  })),
  listIntents: vi.fn(() => []),
  updateIntent: vi.fn((id: string, updates: any) => ({ id, ...updates, updated_at: '2024-01-02' })),
  deleteIntent: vi.fn(() => true),
  getIntent: vi.fn((id: string) => ({
    id,
    folder: 'test-folder',
    description: 'test',
    body: 'test body',
    status: 'captured',
    raw_text: 'raw',
    due_at: null,
    due_at_utc: null,
    completed_at: null,
    updated_at: '2024-01-01',
  })),
  searchIntents: vi.fn(() => [{ id: 'i1', description: 'found' }]),
  updateIntentCAS: vi.fn(() => true),
  logIntentEvent: vi.fn(),
  listIntentEvents: vi.fn(() => []),
  initDatabase: vi.fn(),
  mergeSessionIds: vi.fn(),
  assignIntentFolder: vi.fn(),
  updateCanvasContent: vi.fn(),
  syncCanvasContent: vi.fn(),
  createAgentSession: vi.fn(),
  deleteAgentSession: vi.fn(),
}));

vi.mock('./ai', () => ({
  parseIntentWithAI: vi.fn(async () => ({
    description: 'parsed',
    client: null,
    due_at: null,
    due_at_utc: null,
  })),
  evaluateRecurrence: vi.fn(async () => ({ should_recur: false })),
  findSimilarIntent: vi.fn(async () => null),
  resolveDateWithAI: vi.fn(async () => ({
    date: '2024-01-01',
    utc: '2024-01-01T00:00:00Z',
  })),
  classifyInput: vi.fn(async () => ({ type: 'intent' })),
  setAIModel: vi.fn(async () => {}),
  listAvailableModels: vi.fn(async () => ['gpt-4', 'gpt-3.5']),
}));

vi.mock('./session', () => ({
  launchSession: vi.fn(async () => ({ success: true })),
  getActiveSessionIntentIds: vi.fn(() => []),
  resolveCopilotCliPath: vi.fn(async () => '/usr/bin/copilot'),
  invalidateCliPath: vi.fn(),
}));

vi.mock('./voice', () => ({
  transcribeAudio: vi.fn(async () => 'transcribed text'),
}));

vi.mock('./workspace', () => ({
  initWorkspace: vi.fn(),
  getDbPath: vi.fn((dir: string) => `${dir}/.intent/intents.db`),
  getLogPath: vi.fn((dir: string) => `${dir}/.intent/events.jsonl`),
  initIntentCanvas: vi.fn(() => 'test-folder'),
  readCanvas: vi.fn(() => 'canvas content'),
  writeCanvas: vi.fn(),
  scheduleAutoCommit: vi.fn(),
  saveAttachment: vi.fn(() => ({ path: 'attachments/test.png' })),
  resolveAttachmentPath: vi.fn(() => '/abs/path/test.png'),
  getMimeType: vi.fn(() => 'image/png'),
  getIntentHistory: vi.fn(async () => []),
  restoreIntentVersion: vi.fn(async () => ({ success: true })),
}));

vi.mock('./config', () => ({
  getConfig: vi.fn(() => ({ workspace: '/mock/workspace', sessions: {} })),
  getConfigValue: vi.fn((key: string) => {
    if (key === 'workspace') return '/mock/workspace';
    if (key === 'theme') return 'dark';
    if (key === 'model') return 'gpt-4';
    if (key === 'personas') return [];
    if (key === 'mcpServers') return [];
    if (key === 'cliTools') return [];
    return null;
  }),
  setConfigValue: vi.fn(),
}));

vi.mock('./mcp', () => ({
  listDiscoveredMcpServers: vi.fn(() => [{ name: 'discovered-server' }]),
}));

vi.mock('./notify', () => ({
  notifyAllWindows: vi.fn(),
}));

vi.mock('./validators', () => ({
  validateMcpServers: vi.fn((servers: unknown) => {
    if (!Array.isArray(servers)) return { error: 'invalid payload' };
    return servers;
  }),
  validateCliTools: vi.fn((tools: unknown) => {
    if (!Array.isArray(tools)) return { error: 'invalid payload' };
    return tools;
  }),
}));

vi.mock('./agent-service', () => ({
  launchAgent: vi.fn(async () => ({ agentId: 'a1', sessionId: 's1' })),
  launchQuickAgent: vi.fn(async () => ({ agentId: 'a2', sessionId: 's2' })),
  listAgents: vi.fn(() => []),
  listAllAgents: vi.fn(() => [{ agentId: 'a1', status: 'idle' }]),
  approveAgent: vi.fn(),
  respondToUserInput: vi.fn(),
  respondToElicitation: vi.fn(),
  abortAgent: vi.fn(async () => {}),
  openAgentCli: vi.fn(async () => ({})),
  launchCommentAgent: vi.fn(async () => ({ agentId: 'a3' })),
  sendChatMessage: vi.fn(async () => ({ ok: true })),
  setAgentModel: vi.fn(async () => ({})),
  launchCliSession: vi.fn(async () => ({ agentId: 'cli1' })),
  getAgentHistory: vi.fn(async () => ({ events: [] })),
  subagentTracker: {
    listSubagents: vi.fn(() => []),
    getSubagent: vi.fn(() => null),
  },
}));

vi.mock('./cloud-agent', () => ({
  getWorkspaceRepo: vi.fn(async () => ({ owner: 'test', repo: 'repo' })),
  getGitHubToken: vi.fn(async () => 'token'),
  launchCloudAgent: vi.fn(async () => ({ sessionId: 'cs1', jobId: 123 })),
}));

vi.mock('./cloud-agent-poller', () => ({
  startCloudJobPoller: vi.fn(),
  getCloudJobPollResult: vi.fn(() => ({ status: 'running' })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid'),
}));

// ── Import after mocks ─────────────────────────────────────────────
import { registerIpcHandlers } from './ipc';
import { isInitialized, createIntent, listIntents, updateIntent, deleteIntent, getIntent, searchIntents, logIntentEvent, listIntentEvents, assignIntentFolder, updateCanvasContent } from './database';
import { classifyInput, setAIModel, evaluateRecurrence } from './ai';
import { initIntentCanvas, readCanvas, writeCanvas, scheduleAutoCommit } from './workspace';
import { getConfigValue, setConfigValue } from './config';
import { listDiscoveredMcpServers } from './mcp';
import { validateMcpServers, validateCliTools } from './validators';
import { launchSession } from './session';

const fakeEvent = { sender: { id: 1 } } as any;

function invoke(channel: string, ...args: any[]) {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for "${channel}"`);
  return handler(fakeEvent, ...args);
}

// ── Test suite ──────────────────────────────────────────────────────
describe('IPC handlers', () => {
  beforeAll(() => {
    registerIpcHandlers();
  });

  // ── Intent CRUD ─────────────────────────────────────────────────

  describe('intent:create', () => {
    it('creates an intent and returns it', async () => {
      const result = await invoke('intent:create', {
        body: 'Build a new feature',
        description: 'new feature',
      });
      expect(result).toMatchObject({ id: 'intent-1', status: 'captured' });
      expect(createIntent).toHaveBeenCalledWith({
        body: 'Build a new feature',
        description: 'new feature',
      });
      expect(initIntentCanvas).toHaveBeenCalled();
      expect(assignIntentFolder).toHaveBeenCalledWith('intent-1', 'test-folder');
    });

    it('returns error when DB not initialized', async () => {
      vi.mocked(isInitialized).mockReturnValueOnce(false);
      const result = await invoke('intent:create', { body: 'test' });
      expect(result).toEqual({ error: 'no_workspace' });
    });
  });

  describe('intent:list', () => {
    it('returns empty array when not initialized', () => {
      vi.mocked(isInitialized).mockReturnValueOnce(false);
      const result = invoke('intent:list');
      expect(result).toEqual([]);
    });

    it('returns intents when initialized', () => {
      vi.mocked(listIntents).mockReturnValueOnce([
        { id: 'i1', description: 'test' } as any,
      ]);
      const result = invoke('intent:list');
      expect(result).toEqual([{ id: 'i1', description: 'test' }]);
    });
  });

  describe('intent:update', () => {
    it('calls updateIntent with updates', () => {
      const result = invoke('intent:update', 'intent-1', { description: 'updated' });
      expect(updateIntent).toHaveBeenCalledWith('intent-1', { description: 'updated' });
      expect(result).toMatchObject({ id: 'intent-1', description: 'updated' });
    });

    it('handles status transition to done — completion + recurrence', async () => {
      vi.mocked(getIntent).mockReturnValueOnce({
        id: 'intent-1',
        status: 'active',
        due_at: '2024-06-01',
        due_at_utc: '2024-06-01T00:00:00Z',
      } as any);
      vi.mocked(updateIntent).mockReturnValueOnce({
        id: 'intent-1',
        status: 'done',
        due_at: '2024-06-01',
        due_at_utc: '2024-06-01T00:00:00Z',
        updated_at: '2024-01-02',
      } as any);

      const result = invoke('intent:update', 'intent-1', { status: 'done' });
      expect(result).toMatchObject({ id: 'intent-1', status: 'done' });
      expect(logIntentEvent).toHaveBeenCalledWith(
        'intent-1',
        'completed',
        expect.objectContaining({ due_at: '2024-06-01' }),
      );
      // evaluateRecurrence is called async via handleRecurrence
      await vi.waitFor(() => {
        expect(evaluateRecurrence).toHaveBeenCalled();
      });
    });
  });

  describe('intent:delete', () => {
    it('calls deleteIntent and schedules auto-commit', () => {
      const result = invoke('intent:delete', 'intent-1');
      expect(deleteIntent).toHaveBeenCalledWith('intent-1');
      expect(result).toBe(true);
      expect(scheduleAutoCommit).toHaveBeenCalled();
    });
  });

  // ── Settings ────────────────────────────────────────────────────

  describe('settings:get', () => {
    it('maps workspace_root to config workspace', () => {
      const result = invoke('settings:get', 'workspace_root');
      expect(getConfigValue).toHaveBeenCalledWith('workspace');
      expect(result).toBe('/mock/workspace');
    });

    it('maps theme to theme', () => {
      const result = invoke('settings:get', 'theme');
      expect(result).toBe('dark');
    });

    it('returns null for unknown keys', () => {
      const result = invoke('settings:get', 'nonexistent_key');
      expect(result).toBeNull();
    });
  });

  describe('settings:set', () => {
    it('theme: calls setConfigValue', async () => {
      await invoke('settings:set', 'theme', 'light');
      expect(setConfigValue).toHaveBeenCalledWith('theme', 'light');
    });

    it('model: calls setConfigValue and setAIModel', async () => {
      await invoke('settings:set', 'model', 'gpt-4-turbo');
      expect(setConfigValue).toHaveBeenCalledWith('model', 'gpt-4-turbo');
      expect(setAIModel).toHaveBeenCalledWith('gpt-4-turbo');
    });
  });

  // ── Canvas ──────────────────────────────────────────────────────

  describe('canvas:read', () => {
    it('returns content for valid intent', () => {
      const result = invoke('canvas:read', 'intent-1');
      expect(result).toEqual({ content: 'canvas content' });
      expect(readCanvas).toHaveBeenCalled();
    });

    it('returns error when no workspace', () => {
      vi.mocked(getConfigValue).mockReturnValueOnce(null as any);
      const result = invoke('canvas:read', 'intent-1');
      expect(result).toMatchObject({ error: 'no_workspace' });
    });
  });

  describe('canvas:write', () => {
    it('writes content and updates DB', () => {
      const result = invoke('canvas:write', 'intent-1', 'new content');
      expect(writeCanvas).toHaveBeenCalledWith('/mock/workspace', 'test-folder', 'new content');
      expect(updateCanvasContent).toHaveBeenCalledWith('intent-1', 'new content');
      expect(result).toEqual({ success: true });
    });
  });

  describe('canvas:close', () => {
    it('writes and schedules auto-commit', () => {
      invoke('canvas:close', 'intent-1', 'final content');
      expect(writeCanvas).toHaveBeenCalled();
      expect(updateCanvasContent).toHaveBeenCalled();
      expect(scheduleAutoCommit).toHaveBeenCalledWith('/mock/workspace');
    });
  });

  // ── Search & classify ───────────────────────────────────────────

  describe('intent:search', () => {
    it('returns results from searchIntents', () => {
      const result = invoke('intent:search', 'query');
      expect(searchIntents).toHaveBeenCalledWith('query');
      expect(result).toEqual([{ id: 'i1', description: 'found' }]);
    });

    it('returns empty when not initialized', () => {
      vi.mocked(isInitialized).mockReturnValueOnce(false);
      const result = invoke('intent:search', 'query');
      expect(result).toEqual([]);
    });
  });

  describe('intent:classify', () => {
    it('returns classification result', async () => {
      const result = await invoke('intent:classify', 'what is going on');
      expect(classifyInput).toHaveBeenCalled();
      expect(result).toEqual({ type: 'intent' });
    });
  });

  // ── Agent handlers ──────────────────────────────────────────────

  describe('agent:launch', () => {
    it('returns error when no workspace', async () => {
      vi.mocked(getConfigValue).mockReturnValueOnce(null as any);
      const result = await invoke('agent:launch', 'i1', 'text', {});
      expect(result).toEqual({ error: 'no_workspace' });
    });
  });

  describe('agent:quick-launch', () => {
    it('returns error when no workspace', async () => {
      vi.mocked(getConfigValue).mockReturnValueOnce(null as any);
      const result = await invoke('agent:quick-launch', 'do something');
      expect(result).toEqual({ error: 'no_workspace' });
    });
  });

  describe('agent:list-all', () => {
    it('returns result from listAllAgents', async () => {
      const result = await invoke('agent:list-all');
      expect(result).toEqual([{ agentId: 'a1', status: 'idle' }]);
    });
  });

  // ── MCP handlers ────────────────────────────────────────────────

  describe('mcp:list-discovered', () => {
    it('returns discovered servers', () => {
      const result = invoke('mcp:list-discovered');
      expect(listDiscoveredMcpServers).toHaveBeenCalled();
      expect(result).toEqual([{ name: 'discovered-server' }]);
    });
  });

  describe('mcp:list-custom', () => {
    it('returns custom servers from config', () => {
      const result = invoke('mcp:list-custom');
      expect(result).toEqual([]);
    });
  });

  describe('mcp:save-custom', () => {
    it('validates and saves servers', () => {
      const servers = [{ name: 'srv', type: 'stdio', command: 'echo' }];
      const result = invoke('mcp:save-custom', servers);
      expect(validateMcpServers).toHaveBeenCalledWith(servers);
      expect(setConfigValue).toHaveBeenCalledWith('mcpServers', servers);
      expect(result).toEqual({ ok: true });
    });

    it('returns error for invalid input', () => {
      const result = invoke('mcp:save-custom', 'not-an-array');
      expect(result).toEqual({ error: 'invalid payload' });
    });
  });

  // ── Persona handlers ────────────────────────────────────────────

  describe('personas:list', () => {
    it('returns personas from config', () => {
      const result = invoke('personas:list');
      expect(getConfigValue).toHaveBeenCalledWith('personas');
      expect(result).toEqual([]);
    });
  });

  describe('personas:save', () => {
    it('validates and saves personas', () => {
      const personas = [
        { id: 'p1', handle: 'reviewer', instructions: 'Review code', model: '', runLocation: 'local' },
      ];
      const result = invoke('personas:save', personas);
      expect(result).toEqual({ ok: true });
      expect(setConfigValue).toHaveBeenCalledWith('personas', [
        { id: 'p1', handle: 'reviewer', instructions: 'Review code', model: '', runLocation: 'local' },
      ]);
    });

    it('returns error for non-array input', () => {
      const result = invoke('personas:save', 'invalid');
      expect(result).toEqual({ error: 'invalid payload' });
    });
  });

  // ── CLI tools ───────────────────────────────────────────────────

  describe('cli-tools:save', () => {
    it('validates and saves tools', () => {
      const tools = [{ name: 'tool1' }];
      const result = invoke('cli-tools:save', tools);
      expect(validateCliTools).toHaveBeenCalledWith(tools);
      expect(setConfigValue).toHaveBeenCalledWith('cliTools', tools);
      expect(result).toEqual({ ok: true });
    });
  });

  // ── Misc ────────────────────────────────────────────────────────

  describe('intent:events', () => {
    it('returns events list', () => {
      invoke('intent:events', 50);
      expect(listIntentEvents).toHaveBeenCalledWith(50);
    });
  });

  describe('session:launch', () => {
    it('delegates to launchSession', async () => {
      const result = await invoke('session:launch', 'intent-1');
      expect(launchSession).toHaveBeenCalledWith('intent-1', '/mock/workspace');
      expect(result).toEqual({ success: true });
    });
  });

  describe('handler registration', () => {
    it('registers all expected channels', () => {
      const expected = [
        'intent:create', 'intent:list', 'intent:update', 'intent:delete',
        'intent:search', 'intent:classify', 'intent:events',
        'settings:get', 'settings:set',
        'canvas:read', 'canvas:write', 'canvas:close',
        'mcp:list-discovered', 'mcp:list-custom', 'mcp:save-custom',
        'personas:list', 'personas:save',
        'agent:launch', 'agent:quick-launch', 'agent:list-all',
        'session:launch',
      ];
      for (const ch of expected) {
        expect(handlers.has(ch), `Missing handler: ${ch}`).toBe(true);
      }
    });
  });
});
