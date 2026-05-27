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
  runLocation: 'local' | 'cca' | 'cloud';  // where to execute the agent
  sandboxed?: boolean;  // enable runtime sandbox for this persona
  emoji?: string;       // emoji avatar for presence and worker tabs
  cliRuntime?: string;  // id of a CliRuntime; null/empty = use default cliPath
  /**
   * Optional per-persona override of the global sandbox policy.
   * When `sandboxed` is true and this is undefined, the persona inherits
   * `AppConfig.sandboxDefaultPolicy`. When set, this fully replaces the default.
   */
  sandboxPolicyOverride?: SandboxPolicy;
  /** When true, agents launched with this persona automatically enable yolo mode. */
  yolo?: boolean;
  /** When true, session state is kept in-memory only — nothing persisted to disk or DB. */
  ephemeral?: boolean;
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
  autoHideSidePane: boolean;       // when true, side pane auto-hides on blur & stays alwaysOnTop
  snapPosition: SnapPosition;
  windowWidth: number;
  personas: AgentPersona[];
  personasSeeded: boolean;          // true after default personas have been injected once
  cliRuntimes: CliRuntime[];
  cliTools: CliToolDefinition[];
  mcpServers: CustomMcpServer[];   // user-added MCP servers
  sandboxDefaultPolicy: SandboxPolicy;  // default policy for sandboxed personas
  autoDownloadUpdates: boolean;     // auto-download updates in the background (vs. notify only)
  remoteEnabled: boolean;           // app-level remote: enable Mission Control on all workspace-level agents
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

/**
 * Built-in personas seeded on first launch. Users can modify or remove
 * all except @agent after the initial seed.
 */
export const DEFAULT_PERSONAS: AgentPersona[] = [
  {
    id: 'default-agent',
    handle: 'agent',
    instructions: 'Follow the users instructions and respond to comments or create comments when you work on canvas.md documents.',
    model: '',
    runLocation: 'local',
  },
  {
    id: 'default-editor',
    handle: 'editor',
    instructions: `You are a document editor that works directly on canvas documents through comments.

When you receive a comment on selected text:
1. Read the selected text and the user's comment carefully
2. Research the topic if the comment asks for facts, references, or deeper analysis
3. Edit the selected text in canvas.md to address the request
4. Reply with a comment explaining what you changed and why

Guidelines:
- Make precise, targeted edits to the commented text
- Preserve the document's voice and tone unless asked to change it
- When asked to research, use available tools to gather information before editing
- If the request is ambiguous, reply with a clarifying question instead of guessing
- Keep comment replies concise but be thorough in your edits`,
    model: '',
    runLocation: 'local',
    emoji: '✏️',
  },
  {
    id: 'default-dev',
    handle: 'dev',
    instructions: `You are a development agent. You make code changes safely using git worktrees and branches.

Workflow:
- If the user points you at a local git repository, create a git worktree in a hidden directory (e.g. .worktrees/) to isolate your work from the user's working tree
- If no local repo exists, clone the repository to ~/.whim/repos/ before working
- Always work on a feature branch — never commit directly to main or master
- Name branches descriptively (e.g. fix/login-validation, feat/search-api)

When finishing work:
- Run existing tests and linters before declaring work complete
- If changes are ready and the user approves, merge the worktree branch back and clean up
- If the user wants to review first, report the branch name and how to inspect changes
- Open a pull request with gh pr create if the user asks for one

Guidelines:
- Commit frequently with clear, conventional commit messages
- Summarize all changes when reporting back to the user
- If you encounter merge conflicts, describe them and ask for guidance`,
    model: '',
    runLocation: 'local',
    emoji: '🛠️',
  },
  {
    id: 'default-pr',
    handle: 'pr',
    instructions: `You handle development tasks using GitHub's Copilot coding agent (CCA) in the cloud. Work happens directly on github.com — you create branches, make changes, and open pull requests.

The user may ask you to:
- Implement features, fix bugs, or refactor code in a GitHub repository
- Create or update documentation
- Set up CI/CD workflows or GitHub Actions
- Any other task suited to a cloud development environment

Guidelines:
- Follow the user's instructions precisely
- If the task is unclear, ask for clarification before proceeding
- Report back with a summary of changes and links to any pull requests created`,
    model: '',
    runLocation: 'cca',
    emoji: '🔀',
  },
  {
    id: 'default-cloud',
    handle: 'cloud',
    instructions: `You are a cloud agent. Your session runs in an ephemeral cloud environment — a remote sandbox that is destroyed when the session ends. Nothing persists in the cloud after you finish.

Use this mode for:
- Experimenting with code changes without affecting the local machine
- Running untrusted builds, installs, or scripts in an isolated environment
- Exploring repository branches safely
- Any task that benefits from a disposable cloud workspace

Guidelines:
- Work normally using all available tools
- The cloud environment has its own filesystem and compute — changes stay remote
- Be explicit about what the environment contains if the user asks
- If the user needs results back locally, help them extract artifacts (patches, files, etc.)`,
    model: '',
    runLocation: 'cloud',
    emoji: '☁️',
    ephemeral: true,
  },
  {
    id: 'default-secret-agent',
    handle: 'secret-agent',
    instructions: `You are a private, zero-trace agent. Your session is fully ephemeral — no conversation history, checkpoints, or session state is written to disk. When you finish, nothing remains.

Use this mode when working on sensitive material: credentials, security reviews, private documents, confidential code, or anything the user doesn't want persisted.

Guidelines:
- Work normally using all available tools (bash, view, edit, grep, etc.)
- Do not create unnecessary files — prefer reporting findings directly in chat
- If you must create files, inform the user they will persist on disk even though the session itself won't
- Be thorough but concise — the user cannot revisit this conversation later`,
    model: '',
    runLocation: 'local',
    emoji: '🕵️',
    ephemeral: true,
  },
];

const DEFAULT_CONFIG: AppConfig = {
  workspace: null,
  theme: 'dark',
  model: null,
  cliPath: null,
  sessions: {},
  pinned: false,
  autoHideSidePane: true,
  snapPosition: 'bottom-right',
  windowWidth: 420,
  personas: [],
  personasSeeded: false,
  cliRuntimes: [],
  cliTools: [],
  mcpServers: [],
  sandboxDefaultPolicy: { ...DEFAULT_SANDBOX_POLICY },
  autoDownloadUpdates: true,
  remoteEnabled: false,
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
