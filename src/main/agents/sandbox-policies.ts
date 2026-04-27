/**
 * Sandbox policies for agent sessions (Windows-only).
 *
 * Provides:
 * - Read-only command classification for shell commands
 * - Pre-tool hook that denies non-read-only shell commands
 * - Platform check constant
 */

export const IS_WINDOWS = process.platform === 'win32';

// Read-only command patterns (safe to run in sandbox)
const READ_ONLY_PATTERNS = [
  /^(ls|dir|find|tree)\b/,
  /^(cat|head|tail|less|more|type|Get-Content)\b/,
  /^(grep|rg|ag|ack|findstr|Select-String)\b/,
  /^(wc|sort|uniq|diff|comm)\b/,
  /^(echo|printf|pwd|whoami|hostname|date|uname)\b/,
  /^(git\s+(log|status|diff|show|blame|branch|tag))\b/,
  /^(file|stat|du|df)\b/,
  /^(which|where|command\s+-v)\b/,
  /^(env|printenv|set)\b/,
];

/**
 * Returns true if the command is classified as read-only (safe for sandbox).
 * Conservative: unknown commands are treated as NOT read-only.
 */
export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  return READ_ONLY_PATTERNS.some(re => re.test(trimmed));
}

/**
 * Creates a pre-tool-use hook that denies non-read-only shell commands.
 * Passes through all non-shell tools unchanged.
 */
export function createSandboxPreToolHook() {
  return async (input: { toolName: string; toolArgs: Record<string, unknown> }) => {
    if (input.toolName === 'bash' || input.toolName === 'shell') {
      const command = input.toolArgs?.command;
      if (typeof command === 'string' && !isReadOnlyCommand(command)) {
        return {
          permissionDecision: 'deny' as const,
          permissionDecisionReason: 'Sandbox mode: only read-only commands are allowed',
        };
      }
    }
    return {};
  };
}

/** System prompt appendix for sandboxed sessions. */
export const SANDBOX_SYSTEM_PROMPT = `\n\n[SANDBOX MODE] You are running in a sandboxed environment. You may read files and run read-only commands but must NOT write files, run installs, or execute destructive operations.`;
