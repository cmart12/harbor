import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { DEFAULT_SANDBOX_POLICY, type SandboxPolicy } from '../shared/ipc-contract';

export type { SandboxPolicy };
export { DEFAULT_SANDBOX_POLICY };

export type SnapPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left-center' | 'right-center';

export interface AgentPersona {
  id: string;
  handle: string;       // @mention name (stored lowercase, no @ prefix)
  instructions: string;
  model: string;        // model ID
  runLocation: 'local' | 'cloud';  // where to execute the agent
  sandboxed?: boolean;  // Windows-only; ignored on other platforms
  emoji?: string;       // emoji avatar for presence and worker tabs
  cliRuntime?: string;  // id of a CliRuntime; null/empty = use default cliPath
  /**
   * Optional per-persona override of the global sandbox policy.
   * When `sandboxed` is true and this is undefined, the persona inherits
   * `AppConfig.sandboxDefaultPolicy`. When set, this fully replaces the default.
   */
  sandboxPolicyOverride?: SandboxPolicy;
}

export interface CliRuntime {
  id: string;
  label: string;        // user-friendly name, e.g. "Copilot Dev"
  path: string;         // bare command or full path, resolved like cliPath
}

export interface CliToolDefinition {
  name: string;         // e.g. "gh"
  description: string;  // e.g. "Used for GitHub operations including git, issues, pull requests, actions"
}

export interface CustomMcpServer {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  tools: string[];
}

export interface AppConfig {
  workspace: string | null;
  theme: 'light' | 'dark';
  model: string | null;
  cliPath: string | null;          // user override for Copilot CLI path; null = auto-detect
  sessions: Record<string, string>; // spaceId → copilot CLI sessionId
  pinned: boolean;
  snapPosition: SnapPosition;
  windowWidth: number;
  personas: AgentPersona[];
  cliRuntimes: CliRuntime[];
  cliTools: CliToolDefinition[];
  mcpServers: CustomMcpServer[];   // user-added MCP servers
  sandboxDefaultPolicy: SandboxPolicy;  // default policy for sandboxed personas
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  workspace: null,
  theme: 'light',
  model: null,
  cliPath: null,
  sessions: {},
  pinned: false,
  snapPosition: 'bottom-right',
  windowWidth: 420,
  personas: [],
  cliRuntimes: [],
  cliTools: [],
  mcpServers: [],
  sandboxDefaultPolicy: { ...DEFAULT_SANDBOX_POLICY },
};

let config: AppConfig = { ...DEFAULT_CONFIG };

export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      config = { ...DEFAULT_CONFIG, ...parsed };
      // Deep-merge sandbox default so missing fields fall back to safe defaults
      // when the persisted config predates a newly-added SandboxPolicy field.
      config.sandboxDefaultPolicy = {
        ...DEFAULT_SANDBOX_POLICY,
        ...(parsed.sandboxDefaultPolicy || {}),
      };
    }
  } catch (err) {
    console.error('[config] Failed to load config:', err);
    config = { ...DEFAULT_CONFIG };
  }
  return config;
}

export function saveConfig(): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[config] Failed to save config:', err);
  }
}

export function getConfig(): AppConfig {
  return config;
}

export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return config[key];
}

export function setConfigValue<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
  config[key] = value;
  saveConfig();
}

export function getSessionId(spaceId: string): string | null {
  return config.sessions[spaceId] ?? null;
}

/**
 * Returns the effective sandbox policy for a persona: its override if set,
 * otherwise the global default. Caller should still gate on `persona.sandboxed`
 * before applying this policy.
 */
export function resolveSandboxPolicy(persona: AgentPersona): SandboxPolicy {
  if (persona.sandboxPolicyOverride) {
    // Defensive merge — guarantee all SandboxPolicy fields are present even if
    // the override was persisted before a new field was added.
    return { ...DEFAULT_SANDBOX_POLICY, ...persona.sandboxPolicyOverride };
  }
  return { ...DEFAULT_SANDBOX_POLICY, ...config.sandboxDefaultPolicy };
}

export function setSessionId(spaceId: string, sessionId: string): void {
  config.sessions[spaceId] = sessionId;
  saveConfig();
}

export function removeSession(spaceId: string): void {
  delete config.sessions[spaceId];
  saveConfig();
}
