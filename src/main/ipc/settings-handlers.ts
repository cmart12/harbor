import { ipcMain } from 'electron';
import * as fs from 'fs';
import { setAIModel, listAvailableModels, reinitCopilot } from '../ai';
import { resolveCopilotCliPath, invalidateCliPath, checkCliCompatibility, resolveCommandOnPath, resolveCmdToJs, isCliMxcCapable } from '../session';
import { getConfigValue, setConfigValue, getConfig, type AgentPersona, type CliRuntime } from '../config';
import { listDiscoveredMcpServers } from '../mcp';
import { validateMcpServers, validateCliTools, validateSandboxPolicy } from '../validators';

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', (_event, key: string) => {
    const configKeyMap: Record<string, keyof ReturnType<typeof getConfig>> = {
      workspace_root: 'workspace',
      theme: 'theme',
      model: 'model',
      cli_path: 'cliPath',
    };
    const configKey = configKeyMap[key];
    if (configKey) return getConfigValue(configKey);
    return null;
  });

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    if (key === 'theme') {
      setConfigValue('theme', value as 'light' | 'dark');
    } else if (key === 'model') {
      setConfigValue('model', value);
      await setAIModel(value);
    } else if (key === 'cli_path') {
      let resolved = value || null;
      if (resolved && !fs.existsSync(resolved)) {
        // Bare command name — try to resolve to full path
        const found = resolveCommandOnPath(resolved);
        if (found) resolved = resolveCmdToJs(found);
      }
      setConfigValue('cliPath', resolved);
      invalidateCliPath();
      // Reinitialize the SDK so it picks up the new CLI
      await reinitCopilot();
      return resolved;
    }
  });

  ipcMain.handle('cli:resolve-path', () => {
    return resolveCopilotCliPath();
  });

  ipcMain.handle('cli:check-version', () => {
    return checkCliCompatibility();
  });

  ipcMain.handle('cli:check-mxc-capable', () => {
    return { mxcCapable: isCliMxcCapable() };
  });

  ipcMain.handle('models:list', async () => {
    return listAvailableModels();
  });

  // Agent Personas
  ipcMain.handle('personas:list', () => {
    const personas = getConfigValue('personas') || [];
    // Ensure @agent always exists
    const hasDefault = (personas as AgentPersona[]).some((p: AgentPersona) => p.handle === 'agent');
    if (!hasDefault) {
      const withDefault: AgentPersona[] = [
        {
          id: 'default-agent',
          handle: 'agent',
          instructions: 'Follow the users instructions and respond to comments or create comments when you work on canvas.md documents.',
          model: '',
          runLocation: 'local',
        },
        ...(personas as AgentPersona[]),
      ];
      setConfigValue('personas', withDefault);
      return withDefault;
    }
    return personas;
  });

  ipcMain.handle('personas:save', (_event, personas: unknown) => {
    if (!Array.isArray(personas)) return { error: 'invalid payload' };

    const seen = new Set<string>();
    const validated: AgentPersona[] = [];

    for (const p of personas) {
      if (!p || typeof p !== 'object') continue;
      const raw = p as Record<string, unknown>;

      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      const handle = typeof raw.handle === 'string'
        ? raw.handle.trim().replace(/^@/, '').toLowerCase()
        : '';
      const instructions = typeof raw.instructions === 'string'
        ? raw.instructions.trim().slice(0, 2000)
        : '';
      const model = typeof raw.model === 'string' ? raw.model.trim() : '';
      const runLocation = raw.runLocation === 'cloud' ? 'cloud' as const : 'local' as const;

      const emoji = typeof raw.emoji === 'string' ? raw.emoji.trim().slice(0, 8) : '';
      const cliRuntime = typeof raw.cliRuntime === 'string' ? raw.cliRuntime.trim() : '';

      if (!id || !HANDLE_RE.test(handle) || !instructions) continue;
      if (seen.has(handle)) continue;
      seen.add(handle);

      validated.push({
        id, handle, instructions, model, runLocation,
        ...(raw.sandboxed === true ? { sandboxed: true } : {}),
        ...(emoji ? { emoji } : {}),
        ...(cliRuntime ? { cliRuntime } : {}),
        ...(raw.sandboxed === true && raw.sandboxPolicyOverride !== undefined
          ? (() => {
              const override = validateSandboxPolicy(raw.sandboxPolicyOverride);
              return override ? { sandboxPolicyOverride: override } : {};
            })()
          : {}),
      });
    }

    // Protect @agent: ensure it cannot be removed
    const hasAgent = validated.some(p => p.handle === 'agent');
    if (!hasAgent) {
      const existing = (getConfigValue('personas') as AgentPersona[] || []).find((p: AgentPersona) => p.handle === 'agent');
      if (existing) {
        validated.unshift(existing);
      } else {
        validated.unshift({
          id: 'default-agent',
          handle: 'agent',
          instructions: 'Follow the users instructions and respond to comments or create comments when you work on canvas.md documents.',
          model: '',
          runLocation: 'local',
        });
      }
    }

    setConfigValue('personas', validated);
    return { ok: true };
  });

  // ── CLI Runtimes ─────────────────────────────────────────
  ipcMain.handle('runtimes:list', () => {
    return getConfigValue('cliRuntimes') || [];
  });

  ipcMain.handle('runtimes:save', (_event, runtimes: unknown) => {
    if (!Array.isArray(runtimes)) return { error: 'invalid payload' };

    const seen = new Set<string>();
    const validated: CliRuntime[] = [];

    for (const r of runtimes) {
      if (!r || typeof r !== 'object') continue;
      const raw = r as Record<string, unknown>;

      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 50) : '';
      const rPath = typeof raw.path === 'string' ? raw.path.trim() : '';

      if (!id || !label || !rPath) continue;
      if (seen.has(id)) continue;
      seen.add(id);

      // Resolve bare command names to full paths
      let resolvedPath = rPath;
      if (!fs.existsSync(rPath)) {
        const found = resolveCommandOnPath(rPath);
        if (found) resolvedPath = resolveCmdToJs(found);
      }

      validated.push({ id, label, path: resolvedPath });
    }

    setConfigValue('cliRuntimes', validated);
    return { ok: true, runtimes: validated };
  });

  // ── MCP Servers ──────────────────────────────────────────
  ipcMain.handle('mcp:list-discovered', () => {
    return listDiscoveredMcpServers();
  });

  ipcMain.handle('mcp:list-custom', () => {
    return getConfigValue('mcpServers') || [];
  });

  ipcMain.handle('mcp:save-custom', (_event, servers: unknown) => {
    const result = validateMcpServers(servers);
    if ('error' in result) return result;
    setConfigValue('mcpServers', result);
    return { ok: true };
  });

  // ── CLI Tool Definitions ─────────────────────────────────
  ipcMain.handle('cli-tools:list', () => {
    return getConfigValue('cliTools') || [];
  });

  ipcMain.handle('cli-tools:save', (_event, tools: unknown) => {
    const result = validateCliTools(tools);
    if ('error' in result) return result;
    setConfigValue('cliTools', result);
    return { ok: true };
  });

  // ── Sandbox default policy ───────────────────────────────
  ipcMain.handle('sandbox:get-default', () => {
    return getConfigValue('sandboxDefaultPolicy');
  });

  ipcMain.handle('sandbox:save-default', (_event, policy: unknown) => {
    const validated = validateSandboxPolicy(policy);
    if (!validated) return { error: 'invalid payload' };
    setConfigValue('sandboxDefaultPolicy', validated);
    return { ok: true, policy: validated };
  });
}
