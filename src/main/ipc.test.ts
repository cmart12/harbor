import { describe, it, expect, vi, beforeAll } from 'vitest';

// ── Capture handlers registered via ipcMain.handle ──────────────────
const handlers = new Map<string, Function>();

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/space-test' },
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
  return { ...actual, existsSync: vi.fn(() => true), writeFileSync: vi.fn() };
});

vi.mock('./database', () => ({
  isInitialized: vi.fn(() => true),
  createSpace: vi.fn((input: any) => ({
    id: 'space-1',
    ...input,
    status: 'captured',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  })),
  listSpaces: vi.fn(() => []),
  updateSpace: vi.fn((id: string, updates: any) => ({ id, ...updates, updated_at: '2024-01-02' })),
  deleteSpace: vi.fn(() => true),
  getSpace: vi.fn((id: string) => ({
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
  getSkill: vi.fn((id: string) => ({
    id,
    name: 'Test Skill',
    description: 'A test skill',
    folder: '.agents/skills/' + id,
    filePath: '/mock/workspace/.agents/skills/' + id + '/SKILL.md',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  })),
  searchSpaces: vi.fn(() => [{ id: 'i1', description: 'found' }]),
  updateSpaceCAS: vi.fn(() => true),
  logSpaceEvent: vi.fn(),
  listSpaceEvents: vi.fn(() => []),
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  mergeSessionIds: vi.fn(),
  assignSpaceFolder: vi.fn(),
  updateCanvasContent: vi.fn(),
  syncCanvasContent: vi.fn(),
  createAgentSession: vi.fn(),
  deleteAgentSession: vi.fn(),
  listSkills: vi.fn(() => []),
  upsertSkill: vi.fn(),
  removeSkill: vi.fn(),
}));

vi.mock('./ai', () => ({
  parseSpaceWithAI: vi.fn(async () => ({
    description: 'parsed',
    client: null,
    due_at: null,
    due_at_utc: null,
  })),
  evaluateRecurrence: vi.fn(async () => ({ should_recur: false })),
  findSimilarSpace: vi.fn(async () => null),
  resolveDateWithAI: vi.fn(async () => ({
    date: '2024-01-01',
    utc: '2024-01-01T00:00:00Z',
  })),
  classifyInput: vi.fn(async () => ({ type: 'space' })),
  setAIModel: vi.fn(async () => {}),
  reinitCopilot: vi.fn(async () => {}),
  listAvailableModels: vi.fn(async () => ['gpt-4', 'gpt-3.5']),
}));

vi.mock('./session', () => ({
  launchSession: vi.fn(async () => ({ success: true })),
  getActiveSessionIntentIds: vi.fn(() => []),
  resolveCopilotCliPath: vi.fn(async () => '/usr/bin/copilot'),
  invalidateCliPath: vi.fn(),
  resolveCommandOnPath: vi.fn(() => null),
  resolveCmdToJs: vi.fn((p: string) => p),
  checkCliCompatibility: vi.fn(() => ({ path: '/usr/bin/copilot', version: '1.0.36', compatible: true, minVersion: '1.0.36' })),
}));

vi.mock('./voice', () => ({
  transcribeAudio: vi.fn(async () => 'transcribed text'),
}));

vi.mock('./frontmatter', () => ({
  parseFrontmatter: vi.fn((content: string) => ({ frontmatter: {}, body: content })),
  serializeFrontmatter: vi.fn((fm: any, body: string) => `---\n---\n${body}`),
}));

vi.mock('./workspace', () => ({
  initWorkspace: vi.fn(),
  getDbPath: vi.fn((dir: string) => `${dir}/.whim/spaces.db`),
  getLogPath: vi.fn((dir: string) => `${dir}/.whim/events.jsonl`),
  initSpaceCanvas: vi.fn(() => 'test-folder'),
  readCanvas: vi.fn(() => 'canvas content'),
  writeCanvas: vi.fn(),
  scheduleAutoCommit: vi.fn(),
  commitNow: vi.fn(async () => {}),
  archiveSpaceFolder: vi.fn(),
  deleteSpaceFolder: vi.fn(),
  saveAttachment: vi.fn(() => ({ path: 'attachments/test.png' })),
  resolveAttachmentPath: vi.fn(() => '/abs/path/test.png'),
  getMimeType: vi.fn(() => 'image/png'),
  getSpaceHistory: vi.fn(async () => []),
  restoreSpaceVersion: vi.fn(async () => ({ success: true })),
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

vi.mock('./skill-watcher', () => ({
  getSkillsDir: vi.fn(() => '/mock/workspace/.agents/skills'),
  syncAllSkills: vi.fn(),
  startSkillWatcher: vi.fn(),
  stopSkillWatcher: vi.fn(),
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
import { isInitialized, createSpace, listSpaces, updateSpace, deleteSpace, getSpace, getSkill, searchSpaces, logSpaceEvent, listSpaceEvents, assignSpaceFolder, updateCanvasContent } from './database';
import { classifyInput, setAIModel, evaluateRecurrence } from './ai';
import { initSpaceCanvas, readCanvas, writeCanvas, scheduleAutoCommit, commitNow, archiveSpaceFolder, deleteSpaceFolder } from './workspace';
import { getConfigValue, setConfigValue } from './config';
import { listDiscoveredMcpServers } from './mcp';
import { validateMcpServers, validateCliTools } from './validators';
import { launchSession, resolveCommandOnPath, resolveCmdToJs, invalidateCliPath } from './session';
import * as fs from 'fs';

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

  // ── Space CRUD ─────────────────────────────────────────────────

  describe('space:create', () => {
    it('creates an space and returns it', async () => {
      const result = await invoke('space:create', {
        body: 'Build a new feature',
        description: 'new feature',
      });
      expect(result).toMatchObject({ id: 'space-1', status: 'captured' });
      expect(createSpace).toHaveBeenCalledWith({
        body: 'Build a new feature',
        description: 'new feature',
      });
      expect(initSpaceCanvas).toHaveBeenCalled();
      expect(assignSpaceFolder).toHaveBeenCalledWith('space-1', 'test-folder');
    });

    it('returns error when DB not initialized', async () => {
      vi.mocked(isInitialized).mockReturnValueOnce(false);
      const result = await invoke('space:create', { body: 'test' });
      expect(result).toEqual({ error: 'no_workspace' });
    });
  });

  describe('space:list', () => {
    it('returns empty array when not initialized', () => {
      vi.mocked(isInitialized).mockReturnValueOnce(false);
      const result = invoke('space:list');
      expect(result).toEqual([]);
    });

    it('returns spaces when initialized', () => {
      vi.mocked(listSpaces).mockReturnValueOnce([
        { id: 'i1', description: 'test' } as any,
      ]);
      const result = invoke('space:list');
      expect(result).toEqual([{ id: 'i1', description: 'test' }]);
    });
  });

  describe('space:update', () => {
    it('calls updateSpace with updates', async () => {
      const result = await invoke('space:update', 'space-1', { description: 'updated' });
      expect(updateSpace).toHaveBeenCalledWith('space-1', { description: 'updated' });
      expect(result).toMatchObject({ id: 'space-1', description: 'updated' });
    });

    it('handles status transition to done — completion + recurrence', async () => {
      vi.mocked(getSpace).mockReturnValueOnce({
        id: 'space-1',
        status: 'active',
        due_at: '2024-06-01',
        due_at_utc: '2024-06-01T00:00:00Z',
      } as any);
      vi.mocked(updateSpace).mockReturnValueOnce({
        id: 'space-1',
        status: 'done',
        due_at: '2024-06-01',
        due_at_utc: '2024-06-01T00:00:00Z',
        updated_at: '2024-01-02',
      } as any);

      const result = await invoke('space:update', 'space-1', { status: 'done' });
      expect(result).toMatchObject({ id: 'space-1', status: 'done' });
      expect(logSpaceEvent).toHaveBeenCalledWith(
        'space-1',
        'completed',
        expect.objectContaining({ due_at: '2024-06-01' }),
      );
      // evaluateRecurrence is called async via handleRecurrence
      await vi.waitFor(() => {
        expect(evaluateRecurrence).toHaveBeenCalled();
      });
    });
  });

  describe('space:delete', () => {
    it('calls deleteSpace and schedules auto-commit', () => {
      const result = invoke('space:delete', 'space-1');
      expect(deleteSpace).toHaveBeenCalledWith('space-1');
      expect(result).toBe(true);
      expect(deleteSpaceFolder).toHaveBeenCalledWith('/mock/workspace', 'test-folder');
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

    it('cli_path: stores full path when bare command resolves', async () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(false); // bare name doesn't exist as file
      vi.mocked(resolveCommandOnPath).mockReturnValueOnce('/usr/local/bin/copilot');
      vi.mocked(resolveCmdToJs).mockReturnValueOnce('/usr/local/lib/node_modules/@github/copilot/index.js');
      const result = await invoke('settings:set', 'cli_path', 'copilot');
      expect(resolveCommandOnPath).toHaveBeenCalledWith('copilot');
      expect(resolveCmdToJs).toHaveBeenCalledWith('/usr/local/bin/copilot');
      expect(setConfigValue).toHaveBeenCalledWith('cliPath', '/usr/local/lib/node_modules/@github/copilot/index.js');
      expect(invalidateCliPath).toHaveBeenCalled();
      expect(result).toBe('/usr/local/lib/node_modules/@github/copilot/index.js');
    });

    it('cli_path: stores original value when path exists on disk', async () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true); // path exists as file
      vi.mocked(resolveCommandOnPath).mockClear();
      const result = await invoke('settings:set', 'cli_path', '/already/exists/copilot');
      expect(resolveCommandOnPath).not.toHaveBeenCalled();
      expect(setConfigValue).toHaveBeenCalledWith('cliPath', '/already/exists/copilot');
      expect(result).toBe('/already/exists/copilot');
    });

    it('cli_path: stores bare name when resolution fails', async () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(false);
      vi.mocked(resolveCommandOnPath).mockReturnValueOnce(null);
      const result = await invoke('settings:set', 'cli_path', 'nonexistent-cli');
      expect(setConfigValue).toHaveBeenCalledWith('cliPath', 'nonexistent-cli');
      expect(result).toBe('nonexistent-cli');
    });
  });

  // ── Canvas ──────────────────────────────────────────────────────

  describe('canvas:read', () => {
    it('returns content for valid space', () => {
      const result = invoke('canvas:read', 'space-1');
      expect(result).toEqual({ content: 'canvas content' });
      expect(readCanvas).toHaveBeenCalled();
    });

    it('returns error when no workspace', () => {
      vi.mocked(getConfigValue).mockReturnValueOnce(null as any);
      const result = invoke('canvas:read', 'space-1');
      expect(result).toMatchObject({ error: 'no_workspace' });
    });
  });

  describe('canvas:write', () => {
    it('writes content and updates DB', () => {
      const result = invoke('canvas:write', 'space-1', 'new content');
      expect(writeCanvas).toHaveBeenCalledWith('/mock/workspace', 'test-folder', 'new content');
      expect(updateCanvasContent).toHaveBeenCalledWith('space-1', 'new content');
      expect(result).toEqual({ success: true });
    });

    it('routes __skill__ prefix to skill file write', () => {
      vi.clearAllMocks();
      const result = invoke('canvas:write', '__skill__my-skill', '---\nname: Test\n---\nBody text');
      expect(getSkill).toHaveBeenCalledWith('my-skill');
      // Should NOT call writeCanvas (that's for spaces)
      expect(writeCanvas).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('returns not_found for unknown skill', () => {
      vi.mocked(getSkill).mockReturnValueOnce(undefined as any);
      const result = invoke('canvas:write', '__skill__unknown', 'content');
      expect(result).toEqual({ error: 'not_found' });
    });
  });

  describe('canvas:close', () => {
    it('writes and schedules auto-commit', () => {
      invoke('canvas:close', 'space-1', 'final content');
      expect(writeCanvas).toHaveBeenCalled();
      expect(updateCanvasContent).toHaveBeenCalled();
      expect(scheduleAutoCommit).toHaveBeenCalledWith('/mock/workspace');
    });
  });

  // ── Search & classify ───────────────────────────────────────────

  describe('space:search', () => {
    it('returns results from searchSpaces', () => {
      const result = invoke('space:search', 'query');
      expect(searchSpaces).toHaveBeenCalledWith('query');
      expect(result).toEqual([{ id: 'i1', description: 'found' }]);
    });

    it('returns empty when not initialized', () => {
      vi.mocked(isInitialized).mockReturnValueOnce(false);
      const result = invoke('space:search', 'query');
      expect(result).toEqual([]);
    });
  });

  describe('space:classify', () => {
    it('returns classification result', async () => {
      const result = await invoke('space:classify', 'what is going on');
      expect(classifyInput).toHaveBeenCalled();
      expect(result).toEqual({ type: 'space' });
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

    it('forwards prompt and persona to launchQuickAgent for local persona', async () => {
      const cfg = vi.mocked(getConfigValue);
      cfg.mockImplementationOnce((key: string) => key === 'workspace' ? '/mock/workspace' : null as any);
      cfg.mockImplementationOnce((key: string) => key === 'personas' ? [{
        id: 'p1', handle: 'reviewer', instructions: 'Be a careful reviewer.',
        model: 'gpt-4o', runLocation: 'local',
      }] as any : null as any);
      const { launchQuickAgent } = await import('./agent-service');
      vi.mocked(launchQuickAgent).mockClear();

      const result = await invoke('agent:quick-launch', 'review the auth module', 'reviewer');
      expect(result).toEqual({ agentId: 'a2', sessionId: 's2' });
      expect(launchQuickAgent).toHaveBeenCalledOnce();
      const [prompt, workspace, personaArg] = vi.mocked(launchQuickAgent).mock.calls[0];
      expect(prompt).toBe('review the auth module');
      expect(workspace).toBe('/mock/workspace');
      expect(personaArg).toMatchObject({ handle: 'reviewer', instructions: 'Be a careful reviewer.', model: 'gpt-4o' });
    });

    it('returns error when persona handle does not exist', async () => {
      const cfg = vi.mocked(getConfigValue);
      cfg.mockImplementationOnce((key: string) => key === 'workspace' ? '/mock/workspace' : null as any);
      cfg.mockImplementationOnce((key: string) => key === 'personas' ? [] as any : null as any);
      const result = await invoke('agent:quick-launch', 'do something', 'ghost');
      expect(result).toEqual({ error: 'Persona @ghost not found' });
    });

    it('routes cloud persona to launchCloudAgent and prepends instructions', async () => {
      const cfg = vi.mocked(getConfigValue);
      cfg.mockImplementationOnce((key: string) => key === 'workspace' ? '/mock/workspace' : null as any);
      cfg.mockImplementationOnce((key: string) => key === 'personas' ? [{
        id: 'p2', handle: 'cloudie', instructions: 'You run in the cloud.',
        model: 'gpt-4o', runLocation: 'cloud',
      }] as any : null as any);
      const { launchCloudAgent } = await import('./cloud-agent');
      vi.mocked(launchCloudAgent).mockClear();
      const { launchQuickAgent } = await import('./agent-service');
      vi.mocked(launchQuickAgent).mockClear();

      const result = await invoke('agent:quick-launch', 'fix the build', 'cloudie');
      expect(result).toEqual({ agentId: 'mock-uuid', sessionId: 'cs1' });
      expect(launchQuickAgent).not.toHaveBeenCalled();
      expect(launchCloudAgent).toHaveBeenCalledOnce();
      const cloudPrompt = vi.mocked(launchCloudAgent).mock.calls[0][2];
      expect(cloudPrompt).toContain('You run in the cloud.');
      expect(cloudPrompt).toContain('fix the build');
    });

    it('forwards sandboxed persona to launchQuickAgent (no longer blocks)', async () => {
      const cfg = vi.mocked(getConfigValue);
      cfg.mockImplementationOnce((key: string) => key === 'workspace' ? '/mock/workspace' : null as any);
      cfg.mockImplementationOnce((key: string) => key === 'personas' ? [{
        id: 'p3', handle: 'jail', instructions: 'sandboxed',
        model: 'gpt-4o', runLocation: 'local', sandboxed: true,
      }] as any : null as any);
      const { launchQuickAgent } = await import('./agent-service');
      vi.mocked(launchQuickAgent).mockClear();

      const result = await invoke('agent:quick-launch', 'do something', 'jail');
      expect(result).toEqual({ agentId: 'a2', sessionId: 's2' });
      expect(launchQuickAgent).toHaveBeenCalledOnce();
      const personaArg = vi.mocked(launchQuickAgent).mock.calls[0][2] as any;
      expect(personaArg).toMatchObject({ handle: 'jail', sandboxed: true });
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
    it('seeds default-agent and persists when config is empty', () => {
      // The handler guarantees @agent always exists. On the first call when
      // no personas are saved, it injects default-agent and writes it back
      // through setConfigValue so subsequent listings/saves see it.
      const result = invoke('personas:list');
      expect(getConfigValue).toHaveBeenCalledWith('personas');
      expect(result).toEqual([
        {
          id: 'default-agent',
          handle: 'agent',
          instructions: expect.stringContaining('users instructions'),
          model: '',
          runLocation: 'local',
        },
      ]);
      expect(setConfigValue).toHaveBeenCalledWith('personas', expect.arrayContaining([
        expect.objectContaining({ id: 'default-agent', handle: 'agent' }),
      ]));
    });
  });

  describe('personas:save', () => {
    // The save handler prepends default-agent whenever the input doesn't
    // contain @agent, to prevent users from accidentally deleting it via
    // the personas list editor (which would break the @-mention dropdown
    // and the canvas comment workflow). All four "save without @agent"
    // tests therefore expect the prepended default in the persisted output.
    const DEFAULT_AGENT_PERSONA = {
      id: 'default-agent',
      handle: 'agent',
      instructions: expect.stringContaining('users instructions'),
      model: '',
      runLocation: 'local',
    };

    it('validates and saves personas (prepends default-agent when missing)', () => {
      const personas = [
        { id: 'p1', handle: 'reviewer', instructions: 'Review code', model: '', runLocation: 'local' },
      ];
      const result = invoke('personas:save', personas);
      expect(result).toEqual({ ok: true });
      expect(setConfigValue).toHaveBeenCalledWith('personas', [
        DEFAULT_AGENT_PERSONA,
        { id: 'p1', handle: 'reviewer', instructions: 'Review code', model: '', runLocation: 'local' },
      ]);
    });

    it('returns error for non-array input', () => {
      const result = invoke('personas:save', 'invalid');
      expect(result).toEqual({ error: 'invalid payload' });
    });

    it('preserves sandboxed flag when true (with default-agent prepended)', () => {
      const personas = [
        { id: 'p1', handle: 'safe-bot', instructions: 'Read only', model: '', runLocation: 'local', sandboxed: true },
      ];
      const result = invoke('personas:save', personas);
      expect(result).toEqual({ ok: true });
      expect(setConfigValue).toHaveBeenCalledWith('personas', [
        DEFAULT_AGENT_PERSONA,
        { id: 'p1', handle: 'safe-bot', instructions: 'Read only', model: '', runLocation: 'local', sandboxed: true },
      ]);
    });

    it('omits sandboxed flag when false or missing (with default-agent prepended)', () => {
      const personas = [
        { id: 'p1', handle: 'normal-bot', instructions: 'Do things', model: '', runLocation: 'local', sandboxed: false },
      ];
      const result = invoke('personas:save', personas);
      expect(result).toEqual({ ok: true });
      expect(setConfigValue).toHaveBeenCalledWith('personas', [
        DEFAULT_AGENT_PERSONA,
        { id: 'p1', handle: 'normal-bot', instructions: 'Do things', model: '', runLocation: 'local' },
      ]);
    });

    it('does not duplicate default-agent when caller already includes it', () => {
      // When the editor passes the @agent persona through (the normal flow
      // when saving from the UI), the handler must NOT prepend a duplicate.
      const personas = [
        { id: 'default-agent', handle: 'agent', instructions: 'Custom @agent instructions', model: '', runLocation: 'local' },
        { id: 'p1', handle: 'reviewer', instructions: 'Review code', model: '', runLocation: 'local' },
      ];
      const result = invoke('personas:save', personas);
      expect(result).toEqual({ ok: true });
      expect(setConfigValue).toHaveBeenCalledWith('personas', [
        { id: 'default-agent', handle: 'agent', instructions: 'Custom @agent instructions', model: '', runLocation: 'local' },
        { id: 'p1', handle: 'reviewer', instructions: 'Review code', model: '', runLocation: 'local' },
      ]);
    });
  });

  // ── CLI Runtimes ──────────────────────────────────────────────────

  describe('runtimes:save', () => {
    it('resolves bare command names to full paths', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(resolveCommandOnPath).mockReturnValueOnce('/usr/local/bin/copilot-dev');
      vi.mocked(resolveCmdToJs).mockReturnValueOnce('/usr/local/bin/copilot-dev');

      const runtimes = [{ id: 'rt-1', label: 'Dev', path: 'copilot-dev' }];
      const result = invoke('runtimes:save', runtimes);

      expect(resolveCommandOnPath).toHaveBeenCalledWith('copilot-dev');
      expect(setConfigValue).toHaveBeenCalledWith('cliRuntimes', [
        { id: 'rt-1', label: 'Dev', path: '/usr/local/bin/copilot-dev' },
      ]);
      expect(result).toMatchObject({ ok: true, runtimes: [{ id: 'rt-1', path: '/usr/local/bin/copilot-dev' }] });
    });

    it('keeps path as-is when it exists on disk', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(resolveCommandOnPath).mockClear();

      const runtimes = [{ id: 'rt-1', label: 'Local', path: '/opt/copilot/bin/copilot' }];
      const result = invoke('runtimes:save', runtimes);

      expect(resolveCommandOnPath).not.toHaveBeenCalled();
      expect(setConfigValue).toHaveBeenCalledWith('cliRuntimes', [
        { id: 'rt-1', label: 'Local', path: '/opt/copilot/bin/copilot' },
      ]);
      expect(result).toMatchObject({ ok: true });
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

  describe('space:events', () => {
    it('returns events list', () => {
      invoke('space:events', 50);
      expect(listSpaceEvents).toHaveBeenCalledWith(50);
    });
  });

  describe('session:launch', () => {
    it('delegates to launchSession', async () => {
      const result = await invoke('session:launch', 'space-1');
      expect(launchSession).toHaveBeenCalledWith('space-1', '/mock/workspace');
      expect(result).toEqual({ success: true });
    });
  });

  describe('skill:create-from-prompt', () => {
    it('returns error when no workspace', async () => {
      vi.mocked(getConfigValue).mockReturnValueOnce(null as any);
      const result = await invoke('skill:create-from-prompt', 'triage github issues');
      expect(result).toEqual({ error: 'no_workspace' });
    });

    it('returns error when DB not initialized', async () => {
      vi.mocked(isInitialized).mockReturnValueOnce(false);
      const result = await invoke('skill:create-from-prompt', 'triage github issues');
      expect(result).toEqual({ error: 'no_workspace' });
    });

    it('launches a quick agent with the description', async () => {
      const { launchQuickAgent } = await import('./agent-service');
      vi.mocked(launchQuickAgent).mockClear();
      const result = await invoke('skill:create-from-prompt', 'triage github issues');
      expect(result).toEqual({ agentId: 'a2', sessionId: 's2' });
      expect(launchQuickAgent).toHaveBeenCalledOnce();
      const prompt = vi.mocked(launchQuickAgent).mock.calls[0][0];
      expect(prompt).toContain('triage github issues');
      expect(prompt).toContain('SKILL.md');
      expect(prompt).toContain('/mock/workspace/.agents/skills');
    });

    it('includes existing skill slugs in the prompt to avoid collisions', async () => {
      const { listSkills } = await import('./database');
      vi.mocked(listSkills).mockReturnValueOnce([
        { id: 'pr-review', name: 'PR Review', description: '', folder: '', filePath: '', created_at: '', updated_at: '' },
        { id: 'issue-triage', name: 'Issue Triage', description: '', folder: '', filePath: '', created_at: '', updated_at: '' },
      ] as any);
      const { launchQuickAgent } = await import('./agent-service');
      vi.mocked(launchQuickAgent).mockClear();
      await invoke('skill:create-from-prompt', 'review pull requests');
      const prompt = vi.mocked(launchQuickAgent).mock.calls[0][0];
      expect(prompt).toContain('pr-review');
      expect(prompt).toContain('issue-triage');
      expect(prompt).toContain('DO NOT overwrite');
    });
  });

  describe('handler registration', () => {
    it('registers all expected channels', () => {
      const expected = [
        'space:create', 'space:list', 'space:update', 'space:delete',
        'space:search', 'space:classify', 'space:events',
        'settings:get', 'settings:set',
        'canvas:read', 'canvas:write', 'canvas:close',
        'mcp:list-discovered', 'mcp:list-custom', 'mcp:save-custom',
        'personas:list', 'personas:save',
        'agent:launch', 'agent:quick-launch', 'agent:list-all',
        'session:launch',
        'skill:create-from-prompt',
      ];
      for (const ch of expected) {
        expect(handlers.has(ch), `Missing handler: ${ch}`).toBe(true);
      }
    });
  });
});
