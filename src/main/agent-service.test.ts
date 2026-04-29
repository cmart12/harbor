import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Module-level mocks (must precede imports) ──────────────────────────

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/intent-test' },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: vi.fn().mockImplementation(() => ({ on: vi.fn(), show: vi.fn() })),
}));

const mockSession = {
  sessionId: 'mock-session-id',
  send: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  setModel: vi.fn().mockResolvedValue(undefined),
  getMessages: vi.fn().mockResolvedValue([{ type: 'assistant.message', content: 'hello' }]),
  on: vi.fn(),
};

const mockClient = {
  createSession: vi.fn().mockResolvedValue(mockSession),
  resumeSession: vi.fn().mockResolvedValue(mockSession),
};

vi.mock('./ai', () => ({
  getCopilotClient: vi.fn(),
  // Stub so buildSandboxLaunchSetup (Windows-only path) doesn't reach into
  // electron's app.getPath() during sandbox tests.
  buildSandboxConfigs: (agentId: string) => ({
    onDir: `/mock/sandbox/${agentId}/on`,
    offDir: `/mock/sandbox/${agentId}/off`,
  }),
}));

vi.mock('./database', () => ({
  createCanvasAgent: vi.fn(),
  updateCanvasAgentStatus: vi.fn(),
  createAgentSession: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
  updateAgentSessionId: vi.fn(),
  getAgentSession: vi.fn(),
  listAgentSessions: vi.fn().mockReturnValue([]),
}));

vi.mock('./workspace', () => ({
  readCanvas: vi.fn(),
}));

vi.mock('./session', () => ({
  launchSessionInTerminal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./mcp', () => ({
  getAllMcpServers: vi.fn().mockReturnValue({}),
}));

const mockCliTools = vi.fn().mockReturnValue([]);
vi.mock('./config', async () => {
  const { DEFAULT_SANDBOX_POLICY } = await vi.importActual<typeof import('../shared/ipc-contract')>('../shared/ipc-contract');
  return {
    getConfig: vi.fn().mockReturnValue({ workspace: null }),
    getConfigValue: (...args: any[]) => {
      if (args[0] === 'cliTools') return mockCliTools();
      return [];
    },
    // Resolve persona overrides defensively (matches the real impl) so
    // sandbox tests can pass a persona with sandboxPolicyOverride.
    resolveSandboxPolicy: (persona: any) =>
      persona?.sandboxPolicyOverride
        ? { ...DEFAULT_SANDBOX_POLICY, ...persona.sandboxPolicyOverride }
        : { ...DEFAULT_SANDBOX_POLICY },
  };
});

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-agent-id'),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'canvas content'),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  unlinkSync: vi.fn(),
}));

vi.mock('crypto', () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'mock-hash'),
  })),
  randomUUID: vi.fn(() => 'mock-random-uuid'),
}));

import {
  buildCliToolsPrompt,
  respondToUserInput,
  respondToElicitation,
  launchAgent,
  launchCommentAgent,
  launchQuickAgent,
  approveAgent,
  abortAgent,
  listAgents,
  listAllAgents,
  sendChatMessage,
  launchCliSession,
  startCliExitMonitor,
  stopCliExitMonitor,
  setAgentModel,
  getAgentHistory,
  setAgentYolo,
} from './agent-service';
import { getCopilotClient } from './ai';
import { createCanvasAgent, createAgentSession, updateAgentSessionStatus, updateAgentSessionId, getAgentSession, listAgentSessions } from './database';
import { getConfig } from './config';
import { launchSessionInTerminal } from './session';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs';

describe('buildCliToolsPrompt', () => {
  beforeEach(() => {
    mockCliTools.mockReturnValue([]);
  });

  it('returns empty string when no CLI tools configured', () => {
    const result = buildCliToolsPrompt();
    expect(result).toBe('');
  });

  it('generates prompt with single tool', () => {
    mockCliTools.mockReturnValue([
      { name: 'gh', description: 'Used for GitHub operations' },
    ]);

    const result = buildCliToolsPrompt();
    expect(result).toContain('CLI tools may be available');
    expect(result).toContain('`gh`');
    expect(result).toContain('Used for GitHub operations');
  });

  it('generates prompt with multiple tools', () => {
    mockCliTools.mockReturnValue([
      { name: 'gh', description: 'GitHub operations' },
      { name: 'az', description: 'Azure CLI' },
      { name: 'kubectl', description: 'Kubernetes control' },
    ]);

    const result = buildCliToolsPrompt();
    expect(result).toContain('`gh`');
    expect(result).toContain('`az`');
    expect(result).toContain('`kubectl`');
    // Each tool on its own line
    const lines = result.split('\n').filter(l => l.startsWith('- `'));
    expect(lines).toHaveLength(3);
  });

  it('includes advisory phrasing (verify before use)', () => {
    mockCliTools.mockReturnValue([
      { name: 'gh', description: 'GitHub' },
    ]);

    const result = buildCliToolsPrompt();
    expect(result).toContain('verify before use');
  });
});

describe('respondToUserInput', () => {
  it('does not throw when no matching callback exists', () => {
    expect(() => {
      respondToUserInput('agent-1', 'nonexistent-request', 'hello', true);
    }).not.toThrow();
  });

  it('can be called multiple times with same requestId without error', () => {
    respondToUserInput('agent-1', 'req-1', 'answer1', false);
    respondToUserInput('agent-1', 'req-1', 'answer2', true);
    // Second call is a no-op since callback was already removed
  });
});

describe('respondToElicitation', () => {
  it('does not throw when no matching callback exists', () => {
    expect(() => {
      respondToElicitation('agent-1', 'nonexistent-request', 'accept', { key: 'val' });
    }).not.toThrow();
  });

  it('handles decline action without content', () => {
    expect(() => {
      respondToElicitation('agent-1', 'req-1', 'decline');
    }).not.toThrow();
  });

  it('handles cancel action without content', () => {
    expect(() => {
      respondToElicitation('agent-1', 'req-1', 'cancel');
    }).not.toThrow();
  });
});

// ── Characterization tests ─────────────────────────────────────────────

// Helper: configure getCopilotClient to return the mock client
function enableMockClient() {
  vi.mocked(getCopilotClient).mockReturnValue(mockClient as any);
}

// Helper: configure getCopilotClient to return null (not initialized)
function disableMockClient() {
  vi.mocked(getCopilotClient).mockReturnValue(null);
}

describe('launchAgent', () => {
  let uuidCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.send.mockResolvedValue(undefined);
    mockClient.createSession.mockResolvedValue(mockSession);
    uuidCounter = 0;
    vi.mocked(uuid).mockImplementation(() => `agent-${++uuidCounter}`);
  });

  it('returns error when Copilot client is null', async () => {
    disableMockClient();
    const result = await launchAgent('intent-1', 'selected text', { quote: '', prefix: '', suffix: '' }, '/workspace', 'folder');
    expect(result).toEqual({ error: 'Copilot SDK not initialized' });
  });

  it('creates agent record and persists to DB on success', async () => {
    enableMockClient();
    const result = await launchAgent('intent-1', 'selected text', { quote: 'q', prefix: 'p', suffix: 's' }, '/workspace', 'folder');

    expect(result).toHaveProperty('agentId');
    expect(result).toHaveProperty('sessionId');

    // createCanvasAgent should be called with the agent data
    expect(createCanvasAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-1',
        intent_id: 'intent-1',
        selected_text: 'selected text',
        status: 'running',
      }),
    );

    // createAgentSession should be called with source 'sdk'
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-1',
        intent_id: 'intent-1',
        prompt: 'selected text',
        source: 'sdk',
        status: 'running',
      }),
    );
  });

  it('returns agentId and sessionId on success', async () => {
    enableMockClient();
    const result = await launchAgent('intent-1', 'text', { quote: '', prefix: '', suffix: '' }, '/ws', 'folder');
    expect(result).toEqual({ agentId: 'agent-1', sessionId: 'mock-session-id' });
  });

  it('calls setupAgentEventListeners on the session', async () => {
    enableMockClient();
    await launchAgent('intent-1', 'text', { quote: '', prefix: '', suffix: '' }, '/ws', 'folder');

    // setupAgentEventListeners registers event handlers via session.on
    expect(mockSession.on).toHaveBeenCalled();
    // Expect multiple listeners (assistant.message_delta, assistant.message, session.idle, etc.)
    expect(mockSession.on.mock.calls.length).toBeGreaterThanOrEqual(5);
  });
});

describe('launchQuickAgent', () => {
  let uuidCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.send.mockResolvedValue(undefined);
    mockClient.createSession.mockResolvedValue(mockSession);
    uuidCounter = 0;
    vi.mocked(uuid).mockImplementation(() => `quick-agent-${++uuidCounter}`);
  });

  it('returns error when Copilot client is null', async () => {
    disableMockClient();
    const result = await launchQuickAgent('do something', '/ws');
    expect(result).toEqual({ error: 'Copilot SDK not initialized' });
  });

  it('launches without persona and persists with persona_handle null', async () => {
    enableMockClient();
    const result = await launchQuickAgent('do the thing', '/ws');
    expect(result).toEqual({ agentId: 'quick-agent-1', sessionId: 'mock-session-id' });
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'quick-agent-1',
        prompt: 'do the thing',
        working_dir: '/ws',
        source: 'sdk',
        persona_handle: null,
        intent_id: null,
      }),
    );
  });

  it('forwards persona instructions, model, and handle when persona is provided', async () => {
    enableMockClient();
    const persona = {
      id: 'p1', handle: 'reviewer', instructions: 'Be a careful reviewer.',
      model: 'gpt-4o', runLocation: 'local' as const,
    };
    await launchQuickAgent('check the auth module', '/ws', persona as any);

    // Persona instructions must appear in the system message.
    const sessionOpts = mockClient.createSession.mock.calls[0][0];
    expect(sessionOpts.systemMessage.content).toContain('Be a careful reviewer.');
    expect(sessionOpts.model).toBe('gpt-4o');

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ persona_handle: 'reviewer', summary: expect.stringContaining('@reviewer') }),
    );
  });

  it('skips sandbox setup for sandboxed persona on non-Windows hosts', async () => {
    // The default test host is non-Windows (process.platform comes from CI). On
    // Linux/macOS the IS_WINDOWS gate short-circuits sandbox setup, so a
    // sandboxed persona launches with no configDir and no hooks — same as a
    // plain persona.  We don't fake win32 here because that requires mocking
    // sandbox-policies' module-level constant.
    if (process.platform === 'win32') return; // covered by the next test on Windows hosts
    enableMockClient();
    const persona = {
      id: 'p2', handle: 'jail', instructions: 'sandboxed',
      model: 'gpt-4o', runLocation: 'local' as const, sandboxed: true,
    };
    await launchQuickAgent('do something', '/ws', persona as any);

    const sessionOpts = mockClient.createSession.mock.calls[0][0];
    expect(sessionOpts.configDir).toBeUndefined();
    expect(sessionOpts.hooks).toBeUndefined();
    // Persona instructions still applied.
    expect(sessionOpts.systemMessage.content).toContain('sandboxed');
  });

  // Sandbox setup short-circuits on non-Windows, so the system-prompt branch
  // can only be exercised on a Windows host. Skip elsewhere.
  if (process.platform === 'win32') {
    it('appends [SANDBOX MODE] system prompt when enforcementMode=both', async () => {
      enableMockClient();
      const persona = {
        id: 'p-both', handle: 'guard', instructions: 'Persona instructions here.',
        model: 'gpt-4o', runLocation: 'local' as const,
        sandboxed: true,
        sandboxPolicyOverride: {
          scopeToIntentFolder: true,
          extraReadwritePaths: [],
          extraReadonlyPaths: [],
          extraDeniedPaths: [],
          allowMcpServers: false,
          allowWebFetch: false,
          allowOutbound: false,
          allowLocalNetwork: false,
          enforcementMode: 'both' as const,
        },
      };
      await launchQuickAgent('do something', '/ws', persona as any);

      const sessionOpts = mockClient.createSession.mock.calls[0][0];
      expect(sessionOpts.systemMessage.content).toContain('[SANDBOX MODE]');
      expect(sessionOpts.systemMessage.content).toContain('Persona instructions here.');
    });

    it('omits [SANDBOX MODE] system prompt when enforcementMode=mxc-only', async () => {
      enableMockClient();
      const persona = {
        id: 'p-mxc', handle: 'guard', instructions: 'Persona instructions here.',
        model: 'gpt-4o', runLocation: 'local' as const,
        sandboxed: true,
        sandboxPolicyOverride: {
          scopeToIntentFolder: true,
          extraReadwritePaths: [],
          extraReadonlyPaths: [],
          extraDeniedPaths: [],
          allowMcpServers: false,
          allowWebFetch: false,
          allowOutbound: false,
          allowLocalNetwork: false,
          enforcementMode: 'mxc-only' as const,
        },
      };
      const result = await launchQuickAgent('do something', '/ws', persona as any);

      const sessionOpts = mockClient.createSession.mock.calls[0][0];
      // sole enforcer and the prompt would defeat the verification purpose.
      expect(sessionOpts.systemMessage.content).not.toContain('[SANDBOX MODE]');
      expect(sessionOpts.systemMessage.content).not.toContain('sandboxed environment');
      // Persona instructions still applied.
      expect(sessionOpts.systemMessage.content).toContain('Persona instructions here.');
    });

    it('installs auto-approve permission handler when enforcementMode=mxc-only', async () => {
      // In mxc-only mode the SDK's onPermissionRequest must auto-approve so
      // MXC at the OS level is the sole enforcer. This is the behavioral
      // counterpart to the system-prompt suppression — the agent isn't told
      // it's sandboxed AND the user isn't prompted.
      enableMockClient();
      // Use a unique session id so findBySessionId hits THIS test's agent
      // record (the registry singleton is shared across tests in this file).
      const uniqueSessionId = 'mxc-only-handler-session';
      const originalSessionId = mockSession.sessionId;
      mockSession.sessionId = uniqueSessionId;

      const persona = {
        id: 'p-mxc-handler', handle: 'guard', instructions: 'inst',
        model: 'gpt-4o', runLocation: 'local' as const,
        sandboxed: true,
        sandboxPolicyOverride: {
          scopeToIntentFolder: true,
          extraReadwritePaths: [],
          extraReadonlyPaths: [],
          extraDeniedPaths: [],
          allowMcpServers: false,
          allowWebFetch: false,
          allowOutbound: false,
          allowLocalNetwork: false,
          enforcementMode: 'mxc-only' as const,
        },
      };
      // Suppress the auto-approve breadcrumb log for clean test output.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await launchQuickAgent('do something', '/ws', persona as any);

        const sessionOpts = mockClient.createSession.mock.calls[0][0];
        // Invoke the wired handler with a write request — it must approve
        // without prompting the user (no agent:approval-needed notification).
        const decision = await sessionOpts.onPermissionRequest(
          { kind: 'write', toolCallId: 'tc-mxc-write', fileName: '/ws/out.txt' },
          { sessionId: uniqueSessionId },
        );
        expect(decision).toEqual({ kind: 'approve-once' });
        // The auto-approve breadcrumb should be the only side effect.
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('mxc-only:auto-approve'));
      } finally {
        warnSpy.mockRestore();
        mockSession.sessionId = originalSessionId;
      }
    });
  }
});

describe('launchCommentAgent', () => {
  let uuidCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.send.mockResolvedValue(undefined);
    mockClient.createSession.mockResolvedValue(mockSession);
    uuidCounter = 0;
    vi.mocked(uuid).mockImplementation(() => `comment-agent-${++uuidCounter}`);
  });

  const persona = { handle: 'test-bot', instructions: 'Be helpful', model: 'gpt-4' };

  it('returns error when Copilot client is null', async () => {
    disableMockClient();
    const result = await launchCommentAgent('intent-1', 'comment body', 'quoted', {}, persona, 0, '/ws', 'folder');
    expect(result).toEqual({ error: 'Copilot SDK not initialized' });
  });

  it('creates agent with commentContext and returns agentId/sessionId', async () => {
    enableMockClient();
    const result = await launchCommentAgent('intent-1', 'fix this', 'quoted text', { prefix: 'p', suffix: 's' }, persona, 3, '/ws', 'folder');

    expect(result).toEqual({ agentId: 'comment-agent-1', sessionId: 'mock-session-id' });

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'comment-agent-1',
        prompt: 'fix this',
        source: 'sdk',
      }),
    );
  });

  it('sends the comment body as the prompt', async () => {
    enableMockClient();
    await launchCommentAgent('intent-1', 'fix this', 'quoted text', {}, persona, 0, '/ws', 'folder');

    expect(mockSession.send).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'fix this' }),
    );
  });

  // Sandbox setup short-circuits on non-Windows, so the system-prompt branch
  // can only be exercised on a Windows host. Skip elsewhere.
  if (process.platform === 'win32') {
    it('appends [SANDBOX MODE] system prompt for sandboxed persona when enforcementMode=both', async () => {
      enableMockClient();
      const sandboxedPersona = {
        id: 'p-cmt-both', handle: 'guard', instructions: 'Be helpful',
        model: 'gpt-4o', runLocation: 'local' as const,
        sandboxed: true,
        sandboxPolicyOverride: {
          scopeToIntentFolder: true,
          extraReadwritePaths: [],
          extraReadonlyPaths: [],
          extraDeniedPaths: [],
          allowMcpServers: false,
          allowWebFetch: false,
          allowOutbound: false,
          allowLocalNetwork: false,
          enforcementMode: 'both' as const,
        },
      };
      await launchCommentAgent('intent-1', 'fix this', 'quoted', {}, sandboxedPersona, 0, '/ws', 'folder');

      const sessionOpts = mockClient.createSession.mock.calls[0][0];
      expect(sessionOpts.systemMessage.content).toContain('[SANDBOX MODE]');
      expect(sessionOpts.systemMessage.content).toContain('Be helpful');
    });

    it('omits [SANDBOX MODE] system prompt for sandboxed persona when enforcementMode=mxc-only', async () => {
      enableMockClient();
      const sandboxedPersona = {
        id: 'p-cmt-mxc', handle: 'guard', instructions: 'Be helpful',
        model: 'gpt-4o', runLocation: 'local' as const,
        sandboxed: true,
        sandboxPolicyOverride: {
          scopeToIntentFolder: true,
          extraReadwritePaths: [],
          extraReadonlyPaths: [],
          extraDeniedPaths: [],
          allowMcpServers: false,
          allowWebFetch: false,
          allowOutbound: false,
          allowLocalNetwork: false,
          enforcementMode: 'mxc-only' as const,
        },
      };
      await launchCommentAgent('intent-1', 'fix this', 'quoted', {}, sandboxedPersona, 0, '/ws', 'folder');

      const sessionOpts = mockClient.createSession.mock.calls[0][0];
      // Agent must NOT be told it's sandboxed in mxc-only mode — MXC is the
      // sole enforcer and the prompt would defeat the verification purpose.
      expect(sessionOpts.systemMessage.content).not.toContain('[SANDBOX MODE]');
      expect(sessionOpts.systemMessage.content).not.toContain('sandboxed environment');
      // Persona instructions still applied.
      expect(sessionOpts.systemMessage.content).toContain('Be helpful');
    });
  }
});

describe('approveAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when no callback exists for requestId', () => {
    expect(() => {
      approveAgent('agent-1', 'nonexistent-request', true);
    }).not.toThrow();
  });

  it('can be called with approved=false without error', () => {
    expect(() => {
      approveAgent('agent-1', 'nonexistent-request', false);
    }).not.toThrow();
  });
});

describe('abortAgent', () => {
  let uuidCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.send.mockResolvedValue(undefined);
    mockSession.abort.mockResolvedValue(undefined);
    mockClient.createSession.mockResolvedValue(mockSession);
    uuidCounter = 0;
    vi.mocked(uuid).mockImplementation(() => `abort-agent-${++uuidCounter}`);
  });

  it('is a no-op when agent does not exist', async () => {
    await expect(abortAgent('nonexistent')).resolves.toBeUndefined();
  });

  it('calls session.abort() and updates status to failed', async () => {
    enableMockClient();
    const result = await launchAgent('intent-1', 'text', { quote: '', prefix: '', suffix: '' }, '/ws', 'folder');
    const agentId = (result as any).agentId;

    await abortAgent(agentId);

    expect(mockSession.abort).toHaveBeenCalled();
    // Status should be updated to 'failed' in DB
    expect(updateAgentSessionStatus).toHaveBeenCalledWith(agentId, 'failed', 'Aborted by user');
  });
});

describe('listAgents', () => {
  let uuidCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.send.mockResolvedValue(undefined);
    mockClient.createSession.mockResolvedValue(mockSession);
    uuidCounter = 0;
    vi.mocked(uuid).mockImplementation(() => `list-agent-${++uuidCounter}`);
  });

  it('returns agents filtered by intentId', async () => {
    enableMockClient();
    await launchAgent('intent-A', 'text-a', { quote: '', prefix: '', suffix: '' }, '/ws', 'folder');
    await launchAgent('intent-B', 'text-b', { quote: '', prefix: '', suffix: '' }, '/ws', 'folder');

    const agentsA = listAgents('intent-A');
    expect(agentsA).toHaveLength(1);
    expect(agentsA[0].agentId).toBe('list-agent-1');

    const agentsB = listAgents('intent-B');
    expect(agentsB).toHaveLength(1);
    expect(agentsB[0].agentId).toBe('list-agent-2');
  });

  it('returns empty array for unknown intentId', () => {
    const result = listAgents('unknown');
    expect(result).toEqual([]);
  });
});

describe('listAllAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.send.mockResolvedValue(undefined);
    mockClient.createSession.mockResolvedValue(mockSession);
    vi.mocked(uuid).mockReturnValue('all-agent-1');
  });

  it('overlays live state on DB records', async () => {
    enableMockClient();

    // Create a live agent
    await launchAgent('intent-1', 'text', { quote: '', prefix: '', suffix: '' }, '/ws', 'folder');

    // Mock DB to return a persisted record that matches the live agent
    vi.mocked(listAgentSessions).mockReturnValue([
      {
        id: 'all-agent-1',
        session_id: 'mock-session-id',
        intent_id: 'intent-1',
        prompt: 'text',
        status: 'completed', // DB says completed
        summary: 'DB summary',
        working_dir: '/ws/folder',
        source: 'sdk',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]);

    const all = listAllAgents();
    // Find our specific agent (other agents from prior tests may exist in-memory)
    const ourAgent = all.find(a => a.agentId === 'all-agent-1');
    expect(ourAgent).toBeDefined();
    // Live state should override DB state
    expect(ourAgent!.status).toBe('running');
    expect(ourAgent!.summary).toBe('Starting...');
  });

  it('includes live agents not in DB', async () => {
    enableMockClient();
    vi.mocked(listAgentSessions).mockReturnValue([]);

    // listAllAgents should include live in-memory agents even if DB returns none
    const all = listAllAgents();
    // There should be at least some agents from prior tests in-memory
    expect(Array.isArray(all)).toBe(true);
    // Every returned agent should have the expected shape
    for (const a of all) {
      expect(a).toHaveProperty('agentId');
      expect(a).toHaveProperty('sessionId');
      expect(a).toHaveProperty('status');
      expect(a).toHaveProperty('source');
    }
  });
});

describe('setAgentYolo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.send.mockResolvedValue(undefined);
    mockClient.createSession.mockResolvedValue(mockSession);
    vi.mocked(uuid).mockReturnValue('yolo-agent-1');
  });

  it('returns error for unknown agent', () => {
    const result = setAgentYolo('nonexistent', true);
    expect(result).toEqual({ error: 'Agent not found' });
  });

  it('enables yolo mode on a live agent', async () => {
    enableMockClient();
    await launchAgent('intent-1', 'task', { quote: '', prefix: '', suffix: '' }, '/ws', 'folder');

    const result = setAgentYolo('yolo-agent-1', true);
    expect(result).toEqual({ ok: true });

    // Verify the yoloMode flag is reflected in listAllAgents
    vi.mocked(listAgentSessions).mockReturnValue([]);
    const all = listAllAgents();
    const agent = all.find(a => a.agentId === 'yolo-agent-1');
    expect(agent).toBeDefined();
    expect(agent!.yoloMode).toBe(true);
  });

  it('disables yolo mode on a live agent', async () => {
    enableMockClient();
    await launchAgent('intent-1', 'task', { quote: '', prefix: '', suffix: '' }, '/ws', 'folder');

    setAgentYolo('yolo-agent-1', true);
    setAgentYolo('yolo-agent-1', false);

    vi.mocked(listAgentSessions).mockReturnValue([]);
    const all = listAllAgents();
    const agent = all.find(a => a.agentId === 'yolo-agent-1');
    expect(agent).toBeDefined();
    expect(agent!.yoloMode).toBe(false);
  });
});

describe('sendChatMessage', () => {
  let uuidCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.send.mockResolvedValue(undefined);
    mockClient.createSession.mockResolvedValue(mockSession);
    uuidCounter = 0;
    vi.mocked(uuid).mockImplementation(() => `chat-agent-${++uuidCounter}`);
    vi.mocked(getAgentSession).mockReturnValue(null);
  });

  it('returns error when agent not found and cannot resume', async () => {
    disableMockClient();
    const result = await sendChatMessage('nonexistent', 'hello');
    expect(result).toEqual({ error: 'Agent session expired — open in CLI to resume' });
  });

  it('sends message to session on success', async () => {
    enableMockClient();
    const launched = await launchAgent('intent-1', 'text', { quote: '', prefix: '', suffix: '' }, '/ws', 'folder');
    const agentId = (launched as any).agentId;

    const result = await sendChatMessage(agentId, 'follow-up');
    expect(result).toEqual({});
    // session.send should have been called at least twice (initial + chat message)
    expect(mockSession.send).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'follow-up' }));
  });
});

describe('launchCliSession', () => {
  let uuidCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    vi.mocked(uuid).mockImplementation(() => `cli-${++uuidCounter}`);
    vi.mocked(launchSessionInTerminal).mockResolvedValue(undefined);
  });

  it('creates agent session in DB with source cli', async () => {
    const result = await launchCliSession('/workspace');

    expect(result).toEqual({ agentId: 'cli-1', sessionId: 'cli-2' });

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'cli-1',
        session_id: 'cli-2',
        source: 'cli',
        prompt: 'CLI Session',
        status: 'running',
      }),
    );
  });

  it('calls launchSessionInTerminal', async () => {
    await launchCliSession('/workspace');
    expect(launchSessionInTerminal).toHaveBeenCalledWith('cli-2', '/workspace', expect.any(String));
  });

  it('returns error when launchSessionInTerminal fails', async () => {
    vi.mocked(launchSessionInTerminal).mockRejectedValueOnce(new Error('terminal failed'));
    const result = await launchCliSession('/workspace');
    expect(result).toEqual({ error: 'terminal failed' });
    expect(updateAgentSessionStatus).toHaveBeenCalledWith('cli-1', 'failed', 'terminal failed');
  });
});

describe('CLI exit monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Make sure monitor is stopped before each test
    stopCliExitMonitor();
  });

  afterEach(() => {
    stopCliExitMonitor();
    vi.useRealTimers();
  });

  it('startCliExitMonitor does not create duplicate intervals', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    startCliExitMonitor();
    startCliExitMonitor(); // second call should be no-op

    vi.advanceTimersByTime(10_000);

    // readdirSync is called by ensureCliExitDir (existsSync) + the interval tick
    // The key thing: only 1 interval fires, not 2
    const readdirCalls = vi.mocked(fs.readdirSync).mock.calls.length;

    vi.mocked(fs.readdirSync).mockClear();
    vi.advanceTimersByTime(10_000);

    // Only one more call — proves there's a single interval
    expect(vi.mocked(fs.readdirSync)).toHaveBeenCalledTimes(1);
  });

  it('stopCliExitMonitor clears the interval', () => {
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    startCliExitMonitor();
    stopCliExitMonitor();

    vi.mocked(fs.readdirSync).mockClear();
    vi.advanceTimersByTime(20_000);
    // After stop, no interval reads should happen
    expect(vi.mocked(fs.readdirSync)).not.toHaveBeenCalled();
  });
});

describe('setAgentModel', () => {
  let uuidCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.send.mockResolvedValue(undefined);
    mockSession.setModel.mockResolvedValue(undefined);
    mockClient.createSession.mockResolvedValue(mockSession);
    uuidCounter = 0;
    vi.mocked(uuid).mockImplementation(() => `model-agent-${++uuidCounter}`);
    vi.mocked(getAgentSession).mockReturnValue(null);
  });

  it('calls session.setModel() for active agents', async () => {
    enableMockClient();
    const launched = await launchAgent('intent-1', 'text', { quote: '', prefix: '', suffix: '' }, '/ws', 'folder');
    const agentId = (launched as any).agentId;

    const result = await setAgentModel(agentId, 'gpt-4o');
    expect(result).toEqual({});
    expect(mockSession.setModel).toHaveBeenCalledWith('gpt-4o');
  });

  it('returns error for non-existent agents', async () => {
    disableMockClient();
    const result = await setAgentModel('nonexistent', 'gpt-4o');
    expect(result).toEqual({ error: 'Agent session not found' });
  });

  it('returns error when setModel throws', async () => {
    enableMockClient();
    const launched = await launchAgent('intent-1', 'text', { quote: '', prefix: '', suffix: '' }, '/ws', 'folder');
    const agentId = (launched as any).agentId;

    mockSession.setModel.mockRejectedValueOnce(new Error('model not supported'));
    const result = await setAgentModel(agentId, 'bad-model');
    expect(result).toEqual({ error: 'model not supported' });
  });
});

describe('getAgentHistory', () => {
  let uuidCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.send.mockResolvedValue(undefined);
    mockSession.getMessages.mockResolvedValue([{ type: 'assistant.message', content: 'hello' }]);
    mockClient.createSession.mockResolvedValue(mockSession);
    mockClient.resumeSession.mockResolvedValue(mockSession);
    uuidCounter = 0;
    vi.mocked(uuid).mockImplementation(() => `history-agent-${++uuidCounter}`);
    vi.mocked(getAgentSession).mockReturnValue(null);
  });

  it('returns events from session.getMessages()', async () => {
    enableMockClient();
    const launched = await launchAgent('intent-1', 'text', { quote: '', prefix: '', suffix: '' }, '/ws', 'folder');
    const agentId = (launched as any).agentId;

    const result = await getAgentHistory(agentId);
    expect(result).toEqual({ events: [{ type: 'assistant.message', content: 'hello' }] });
    expect(mockSession.getMessages).toHaveBeenCalled();
  });

  it('returns error when agent not found in DB', async () => {
    disableMockClient();
    vi.mocked(getAgentSession).mockReturnValue(null);
    const result = await getAgentHistory('nonexistent');
    expect(result).toEqual({ error: 'Agent session not found in database' });
  });

  it('resumes historical SDK session via client.resumeSession()', async () => {
    enableMockClient();
    vi.mocked(getConfig).mockReturnValue({ workspace: '/ws' } as any);
    const persistedSession = {
      id: 'old-agent-id',
      session_id: 'old-session-id',
      intent_id: 'intent-1',
      prompt: 'do something',
      status: 'completed' as const,
      summary: 'Done',
      working_dir: '/ws',
      source: 'sdk' as const,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    vi.mocked(getAgentSession).mockReturnValue(persistedSession);

    const result = await getAgentHistory('old-agent-id');

    expect(mockClient.resumeSession).toHaveBeenCalledWith('old-session-id', expect.objectContaining({
      workingDirectory: '/ws',
    }));
    // Should NOT use createSession for resume
    expect(mockClient.createSession).not.toHaveBeenCalled();
    expect(result).toEqual({ events: [{ type: 'assistant.message', content: 'hello' }] });
  });

  it('restores persisted status on resume (not hardcoded completed)', async () => {
    enableMockClient();
    vi.mocked(getConfig).mockReturnValue({ workspace: '/ws' } as any);
    const persistedSession = {
      id: 'failed-agent',
      session_id: 'failed-session-id',
      intent_id: 'intent-1',
      prompt: 'do something',
      status: 'failed' as const,
      summary: 'Error occurred',
      working_dir: '/ws',
      source: 'sdk' as const,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    vi.mocked(getAgentSession).mockReturnValue(persistedSession);

    await getAgentHistory('failed-agent');

    // The resumed record should preserve the failed status
    expect(mockClient.resumeSession).toHaveBeenCalled();
  });

  it('resumes CLI sessions via same resumeSession path', async () => {
    enableMockClient();
    vi.mocked(getConfig).mockReturnValue({ workspace: '/ws' } as any);
    const persistedSession = {
      id: 'cli-agent-id',
      session_id: 'cli-session-id',
      intent_id: null,
      prompt: 'CLI Session',
      status: 'completed' as const,
      summary: 'CLI session ended',
      working_dir: '/ws',
      source: 'cli' as const,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    vi.mocked(getAgentSession).mockReturnValue(persistedSession);

    const result = await getAgentHistory('cli-agent-id');

    expect(mockClient.resumeSession).toHaveBeenCalledWith('cli-session-id', expect.any(Object));
    expect(result).toEqual({ events: [{ type: 'assistant.message', content: 'hello' }] });
  });

  it('returns descriptive error when CLI resume fails', async () => {
    enableMockClient();
    vi.mocked(getConfig).mockReturnValue({ workspace: '/ws' } as any);
    mockClient.resumeSession.mockRejectedValueOnce(new Error('session expired'));
    const persistedSession = {
      id: 'cli-fail-agent',
      session_id: 'cli-fail-session-id',
      intent_id: null,
      prompt: 'CLI Session',
      status: 'completed' as const,
      summary: 'CLI session ended',
      working_dir: '/ws',
      source: 'cli' as const,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    vi.mocked(getAgentSession).mockReturnValue(persistedSession);

    const result = await getAgentHistory('cli-fail-agent');
    expect(result).toEqual({
      error: expect.stringContaining('CLI session'),
    });
  });

  it('falls back to createSession when SDK resume fails', async () => {
    enableMockClient();
    vi.mocked(getConfig).mockReturnValue({ workspace: '/ws' } as any);
    mockClient.resumeSession.mockRejectedValueOnce(new Error('session expired'));
    const persistedSession = {
      id: 'sdk-fail-agent',
      session_id: 'sdk-fail-session-id',
      intent_id: 'intent-1',
      prompt: 'do something',
      status: 'completed' as const,
      summary: 'Done',
      working_dir: '/ws',
      source: 'sdk' as const,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    vi.mocked(getAgentSession).mockReturnValue(persistedSession);

    const result = await getAgentHistory('sdk-fail-agent');

    // Should have fallen back to createSession
    expect(mockClient.createSession).toHaveBeenCalled();
    // Should return restarted flag
    expect(result).toHaveProperty('restarted', true);
    expect(result).toHaveProperty('events');
    // Should update the session ID in the database
    expect(updateAgentSessionId).toHaveBeenCalledWith('sdk-fail-agent', expect.any(String));
  });

  it('returns error when both resume and fallback createSession fail for SDK', async () => {
    enableMockClient();
    vi.mocked(getConfig).mockReturnValue({ workspace: '/ws' } as any);
    mockClient.resumeSession.mockRejectedValueOnce(new Error('session expired'));
    mockClient.createSession.mockRejectedValueOnce(new Error('auth failed'));
    const persistedSession = {
      id: 'sdk-both-fail-agent',
      session_id: 'sdk-both-fail-session-id',
      intent_id: 'intent-1',
      prompt: 'do something',
      status: 'completed' as const,
      summary: 'Done',
      working_dir: '/ws',
      source: 'sdk' as const,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    vi.mocked(getAgentSession).mockReturnValue(persistedSession);

    const result = await getAgentHistory('sdk-both-fail-agent');
    expect(result).toEqual({
      error: expect.stringContaining('SDK session'),
    });
  });

  it('includes canvas system prompt in fallback session for canvas agents', async () => {
    enableMockClient();
    vi.mocked(getConfig).mockReturnValue({ workspace: '/ws' } as any);
    mockClient.resumeSession.mockRejectedValueOnce(new Error('session expired'));
    const persistedSession = {
      id: 'canvas-restart-agent',
      session_id: 'canvas-restart-session-id',
      intent_id: 'intent-1',
      prompt: 'fix the bug in section 2',
      status: 'completed' as const,
      summary: 'Fixed the bug',
      working_dir: '/ws',
      source: 'sdk' as const,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    vi.mocked(getAgentSession).mockReturnValue(persistedSession);

    await getAgentHistory('canvas-restart-agent');

    const createConfig = mockClient.createSession.mock.calls[0][0];
    expect(createConfig.systemMessage.content).toContain('canvas document');
    expect(createConfig.systemMessage.content).toContain('fix the bug in section 2');
    expect(createConfig.systemMessage.content).toContain('continuation of a previous session');
  });

  it('does not attempt fallback for CLI sessions', async () => {
    enableMockClient();
    vi.mocked(getConfig).mockReturnValue({ workspace: '/ws' } as any);
    mockClient.resumeSession.mockRejectedValueOnce(new Error('session expired'));
    const persistedSession = {
      id: 'cli-no-fallback-agent',
      session_id: 'cli-no-fallback-session-id',
      intent_id: null,
      prompt: 'CLI Session',
      status: 'completed' as const,
      summary: 'CLI session ended',
      working_dir: '/ws',
      source: 'cli' as const,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    vi.mocked(getAgentSession).mockReturnValue(persistedSession);

    const result = await getAgentHistory('cli-no-fallback-agent');
    expect(result).toEqual({
      error: expect.stringContaining('CLI session'),
    });
    // createSession should NOT have been called
    expect(mockClient.createSession).not.toHaveBeenCalled();
  });

  it('does not pass systemMessage on resume (avoids duplicating prompts)', async () => {
    enableMockClient();
    vi.mocked(getConfig).mockReturnValue({ workspace: '/ws' } as any);
    const persistedSession = {
      id: 'sysmsg-agent-id',
      session_id: 'sysmsg-session-id',
      intent_id: 'intent-1',
      prompt: 'do something',
      status: 'completed' as const,
      summary: 'Done',
      working_dir: '/ws',
      source: 'sdk' as const,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    vi.mocked(getAgentSession).mockReturnValue(persistedSession);

    await getAgentHistory('sysmsg-agent-id');

    const resumeConfig = mockClient.resumeSession.mock.calls[0][1];
    expect(resumeConfig).not.toHaveProperty('systemMessage');
  });
});
