/**
 * Shared sandbox-launch setup used by both canvas-comment launches
 * (intent-folder scope) and Workers-tab quick-launch (workspace-root scope).
 *
 * Encapsulates the persona-sandbox glue that was originally inlined in
 * comment-workflow.ts: policy resolution, sandbox config materialization,
 * MCP/web-fetch filtering, allow-list state, and the pre/post-tool hooks
 * that drive the bubble-up dialog.
 */

import { type AgentPersona, resolveSandboxPolicy } from '../config';
import { buildSandboxConfigs, type SandboxConfigDirs } from '../ai';
import { getAllMcpServers } from '../mcp';
import { getCustomTools } from '../tools';
import type { SandboxPolicy } from '../../shared/ipc-contract';
import { AgentRegistry, type SandboxRuntimeState } from './agent-registry';
import { InteractionBroker } from './interaction-broker';
import {
  IS_WINDOWS,
  resolvePathPolicy,
  createSandboxPathPolicyHook,
  createSandboxShellDenialHook,
  normalizePath,
} from './sandbox-policies';

type McpServersMap = ReturnType<typeof getAllMcpServers>;

export interface SandboxLaunchSetup {
  isSandboxed: boolean;
  /** Resolved policy when sandboxed. */
  policy: SandboxPolicy | null;
  /** Sandbox config dirs to pass to client.createSession({ configDir }). */
  sandboxConfigs: SandboxConfigDirs | null;
  /** Filtered MCP servers (empty object if MCP is denied). */
  mcpServers: McpServersMap;
  /** Filtered custom tools list (drops web_fetch if denied). */
  customTools: ReturnType<typeof getCustomTools>;
  /** Runtime state to store on the AgentRecord. */
  sandboxState: SandboxRuntimeState | undefined;
  /** SDK hooks (onPreToolUse, onPostToolUse) when sandboxed. */
  hooks: Record<string, unknown> | undefined;
}

/**
 * Build the sandbox setup for a persona-driven session. Returns a
 * pass-through (`isSandboxed: false`) result for non-sandboxed personas or
 * non-Windows hosts so callers can spread the result unconditionally.
 *
 * The hooks closures capture `agentId` so they can look up the live
 * `AgentRecord.sandbox` state on every tool use — this lets the user
 * disable sandbox mid-session via the bubble-up dialog.
 */
export function buildSandboxLaunchSetup(opts: {
  agentId: string;
  workingDir: string;
  persona: AgentPersona;
  registry: AgentRegistry;
  broker: InteractionBroker;
}): SandboxLaunchSetup {
  const { agentId, workingDir, persona, registry, broker } = opts;
  const allMcpServers = getAllMcpServers();
  const allCustomTools = getCustomTools();

  const isSandboxed = persona.sandboxed === true && IS_WINDOWS;

  if (!isSandboxed) {
    return {
      isSandboxed: false,
      policy: null,
      sandboxConfigs: null,
      mcpServers: allMcpServers,
      customTools: allCustomTools,
      sandboxState: undefined,
      hooks: undefined,
    };
  }

  const policy = resolveSandboxPolicy(persona);
  const sandboxConfigs = buildSandboxConfigs(agentId, workingDir, policy);

  const mcpServers = !policy.allowMcpServers ? {} : allMcpServers;
  const customTools = !policy.allowWebFetch
    ? allCustomTools.filter((t: any) => t?.name !== 'web_fetch' && t?.name !== 'web-fetch')
    : allCustomTools;

  const sandboxState: SandboxRuntimeState = {
    policy: resolvePathPolicy(workingDir, policy),
    configs: sandboxConfigs!,
    state: 'on',
    allowMcpServers: policy.allowMcpServers,
    allowWebFetch: policy.allowWebFetch,
    allowList: { paths: new Set<string>(), resources: new Set<string>(), webFetch: false },
  };

  const onBlock = async (info: { toolName: string; kind: 'read' | 'write' | 'web-fetch' | 'shell'; target: string; requiresWrite: boolean }) => {
    const livingRecord = registry.get(agentId);
    if (!livingRecord) return { permissionDecision: 'deny' as const };
    const resolution = await broker.emitSandboxBlock(livingRecord, {
      source: 'pre-tool',
      kind: info.kind,
      toolName: info.toolName,
      target: info.target,
      allowedDecisions: info.kind === 'shell' ? ['allow-once', 'disable'] : ['allow-once', 'allow-for-session', 'disable'],
    });
    if (resolution.decision === 'allow-once' || resolution.decision === 'disable') {
      return { permissionDecision: 'allow' as const };
    }
    if (resolution.decision === 'allow-for-session' && livingRecord.sandbox) {
      if (info.kind === 'web-fetch') {
        livingRecord.sandbox.allowList.webFetch = true;
      } else {
        livingRecord.sandbox.allowList.paths.add(normalizePath(info.target));
      }
      return { permissionDecision: 'allow' as const };
    }
    return { permissionDecision: 'deny' as const };
  };

  const hooks: Record<string, unknown> = {
    onPreToolUse: createSandboxPathPolicyHook({
      policy: sandboxState.policy,
      allowWebFetch: policy.allowWebFetch,
      isDisabled: () => registry.get(agentId)?.sandbox?.state === 'off',
      allowList: () => registry.get(agentId)?.sandbox?.allowList ?? sandboxState.allowList,
      onBlock,
    }),
    onPostToolUse: createSandboxShellDenialHook({
      isDisabled: () => registry.get(agentId)?.sandbox?.state === 'off',
      onBlock: async (info) => {
        const livingRecord = registry.get(agentId);
        if (!livingRecord) return;
        await broker.emitSandboxBlock(livingRecord, {
          source: 'post-tool-shell',
          kind: 'shell',
          toolName: info.toolName,
          target: info.target,
          intention: `Possible MXC denial detected: "${info.matchedPattern}"`,
          allowedDecisions: ['allow-once', 'disable'],
        });
      },
    }),
  };

  return {
    isSandboxed: true,
    policy,
    sandboxConfigs,
    mcpServers,
    customTools,
    sandboxState,
    hooks,
  };
}
