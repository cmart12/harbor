import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_SANDBOX_POLICY, type SandboxPolicy } from '../../shared/ipc-contract';

// Electron must be mocked before any modules that import it indirectly.
vi.mock('electron', () => ({
  app: { getPath: () => path.join(os.tmpdir(), 'space-sandbox-launch-test') },
}));

// Stub MCP + tools registries so we don't pull in their full graphs.
vi.mock('../mcp', () => ({
  getAllMcpServers: () => ({}),
}));

vi.mock('../tools', () => ({
  getCustomTools: () => [{ name: 'web_fetch' }, { name: 'other_tool' }],
}));

// Stub ai.ts so buildSandboxConfigs doesn't reach into electron via require().
// Returning realistic-looking paths lets our assertions still verify the shape.
vi.mock('../ai', () => ({
  buildSandboxConfigs: (agentId: string, _workingDir: string, _policy: SandboxPolicy) => ({
    onDir: path.join('/tmp', 'sandbox-config', agentId, 'on'),
    offDir: path.join('/tmp', 'sandbox-config', agentId, 'off'),
  }),
}));

import { buildSandboxLaunchSetup } from './sandbox-launch';
import { AgentRegistry } from './agent-registry';
import { InteractionBroker } from './interaction-broker';
import type { AgentNotifier } from './agent-notifier';
import type { AgentPersistence } from './agent-persistence';

function makeNotifier(): AgentNotifier {
  return { notifyRenderer: vi.fn(), showApprovalNotification: vi.fn() } as unknown as AgentNotifier;
}
function makePersistence(): AgentPersistence {
  return { updateStatus: vi.fn() } as unknown as AgentPersistence;
}

const IS_WINDOWS = process.platform === 'win32';

describe('buildSandboxLaunchSetup', () => {
  let registry: AgentRegistry;
  let broker: InteractionBroker;

  beforeEach(() => {
    registry = new AgentRegistry();
    broker = new InteractionBroker(makeNotifier(), makePersistence());
  });

  it('returns isSandboxed=false for a non-sandboxed persona', () => {
    const setup = buildSandboxLaunchSetup({
      agentId: 'a1',
      workingDir: path.join(os.tmpdir(), 'a1-work'),
      persona: { id: 'p1', handle: 'p', instructions: '', model: 'gpt', runLocation: 'local', sandboxed: false },
      registry,
      broker,
    });
    expect(setup.isSandboxed).toBe(false);
    expect(setup.hooks).toBeUndefined();
    expect(setup.enforcementMode).toBe('both');
  });

  // Sandbox is Windows-only. On non-Windows, the setup early-returns
  // isSandboxed=false regardless of policy.
  if (IS_WINDOWS) {
    function makeSandboxedPersona(override: Partial<SandboxPolicy> = {}) {
      return {
        id: 'p1', handle: 'p', instructions: '', model: 'gpt', runLocation: 'local' as const,
        sandboxed: true,
        sandboxPolicyOverride: { ...DEFAULT_SANDBOX_POLICY, ...override },
      };
    }

    it('installs both onPreToolUse + onPostToolUse in enforcementMode=both', () => {
      const setup = buildSandboxLaunchSetup({
        agentId: 'a1',
        workingDir: path.join(os.tmpdir(), 'a1-work'),
        persona: makeSandboxedPersona({ enforcementMode: 'both' }),
        registry,
        broker,
      });
      expect(setup.isSandboxed).toBe(true);
      expect(setup.enforcementMode).toBe('both');
      expect(setup.hooks).toBeDefined();
      expect(setup.hooks).toHaveProperty('onPreToolUse');
      expect(setup.hooks).toHaveProperty('onPostToolUse');
    });

    it('skips onPreToolUse but keeps onPostToolUse in enforcementMode=mxc-only', () => {
      const setup = buildSandboxLaunchSetup({
        agentId: 'a2',
        workingDir: path.join(os.tmpdir(), 'a2-work'),
        persona: makeSandboxedPersona({ enforcementMode: 'mxc-only' }),
        registry,
        broker,
      });
      expect(setup.isSandboxed).toBe(true);
      expect(setup.enforcementMode).toBe('mxc-only');
      expect(setup.hooks).toBeDefined();
      expect(setup.hooks).not.toHaveProperty('onPreToolUse');
      expect(setup.hooks).toHaveProperty('onPostToolUse');
    });

    it('still pre-materializes config dirs in mxc-only so MXC stays enabled', () => {
      const setup = buildSandboxLaunchSetup({
        agentId: 'a3',
        workingDir: path.join(os.tmpdir(), 'a3-work'),
        persona: makeSandboxedPersona({ enforcementMode: 'mxc-only' }),
        registry,
        broker,
      });
      expect(setup.sandboxConfigs).toBeTruthy();
      expect(setup.sandboxConfigs?.onDir).toMatch(/sandbox-config[\\/]a3[\\/]on/);
      expect(setup.sandboxConfigs?.offDir).toMatch(/sandbox-config[\\/]a3[\\/]off/);
    });    it('still strips web_fetch when allowWebFetch=false in mxc-only', () => {
      const setup = buildSandboxLaunchSetup({
        agentId: 'a4',
        workingDir: path.join(os.tmpdir(), 'a4-work'),
        persona: makeSandboxedPersona({ enforcementMode: 'mxc-only', allowWebFetch: false }),
        registry,
        broker,
      });
      expect(setup.customTools.some((t: any) => t?.name === 'web_fetch')).toBe(false);
      expect(setup.customTools.some((t: any) => t?.name === 'other_tool')).toBe(true);
    });

    it('keeps web_fetch when allowWebFetch=true in mxc-only', () => {
      const setup = buildSandboxLaunchSetup({
        agentId: 'a5',
        workingDir: path.join(os.tmpdir(), 'a5-work'),
        persona: makeSandboxedPersona({ enforcementMode: 'mxc-only', allowWebFetch: true }),
        registry,
        broker,
      });
      expect(setup.customTools.some((t: any) => t?.name === 'web_fetch')).toBe(true);
    });
  }
});
