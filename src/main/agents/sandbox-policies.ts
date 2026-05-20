/**
 * Sandbox policies for agent sessions.
 *
 * Provides:
 * - Read-only command classification for shell commands
 * - Pre-tool hook that denies non-read-only shell commands
 * - Path-policy engine for host-side enforcement of path-bearing tools
 *   (view/edit/create/glob/grep/etc.) since runtime sandbox only sandboxes shell
 * - Platform check constant (for path normalization, not sandbox availability)
 */

import * as path from 'path';
import * as fs from 'fs';
import type { SandboxPolicy, SandboxLayer } from '../../shared/ipc-contract';

export type { SandboxLayer } from '../../shared/ipc-contract';

export const IS_WINDOWS = process.platform === 'win32';

/**
 * Lightweight tagged-denial logger. Centralized so every host-side guard logs
 * with a consistent prefix that mentions the layer that fired. Tests can spy
 * on `console.warn` to assert the right layer was logged.
 */
export function logSandboxLayerDenial(
  layer: SandboxLayer,
  details: { agentId?: string; toolName?: string; target?: string; reason?: string },
): void {
  const parts = [`[sandbox][${layer}]`];
  if (details.agentId) parts.push(`agent=${details.agentId}`);
  if (details.toolName) parts.push(`tool=${details.toolName}`);
  if (details.target) parts.push(`target=${details.target}`);
  if (details.reason) parts.push(`reason=${details.reason}`);
  console.warn(parts.join(' '));
}

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
  return async (input: { toolName: string; toolArgs: unknown }, _invocation?: { sessionId: string }) => {
    if (input.toolName === 'bash' || input.toolName === 'shell') {
      const args = input.toolArgs as Record<string, unknown> | undefined;
      const command = args?.command;
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

/** System prompt prefix shared by all sandboxed sessions. */
const SANDBOX_PROMPT_PREFIX = `\n\n[SANDBOX MODE] You are running in a sandboxed environment. You may read files and run read-only commands within the allowed scope but must NOT write files outside it, run installs, or execute destructive operations.`;

/** System prompt suffix for sandboxed sessions scoped to an space folder. */
export const SANDBOX_SYSTEM_PROMPT = `${SANDBOX_PROMPT_PREFIX} Your scope is this space's folder. Do not attempt to access sibling space folders or the parent workspace.`;

/** System prompt suffix for sandboxed sessions scoped to the workspace root. */
export const SANDBOX_WORKSPACE_SYSTEM_PROMPT = `${SANDBOX_PROMPT_PREFIX} Your scope is the workspace root. Do not attempt to access paths outside the workspace.`;

// ─────────────────────────────────────────────────────────────────────────────
// Path-policy engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolved scope for a single agent: space folder + extra paths from policy.
 * Constructed once at agent launch and reused on every path check.
 */
export interface ResolvedPathPolicy {
  scopeToSpaceFolder: boolean;
  intentFolder: string;          // absolute, normalized
  readwritePaths: string[];      // absolute, normalized (includes intentFolder when scopeToSpaceFolder)
  readonlyPaths: string[];       // absolute, normalized
  deniedPaths: string[];         // absolute, normalized — checked first, wins over allow lists
}

/**
 * Resolve and normalize the policy paths against an space folder. Best-effort
 * `realpath` to canonicalize symlinks/junctions; tolerates ENOENT for paths
 * that don't yet exist. Always returns absolute, OS-normalized paths.
 */
export function resolvePathPolicy(
  intentFolder: string,
  policy: Pick<SandboxPolicy, 'scopeToSpaceFolder' | 'extraReadwritePaths' | 'extraReadonlyPaths' | 'extraDeniedPaths'>,
): ResolvedPathPolicy {
  const norm = (p: string) => normalizePath(p);
  const space = norm(intentFolder);
  const rw = policy.extraReadwritePaths.map(norm);
  if (policy.scopeToSpaceFolder && !rw.some(p => samePath(p, space))) {
    rw.unshift(space);
  }
  return {
    scopeToSpaceFolder: policy.scopeToSpaceFolder,
    intentFolder: space,
    readwritePaths: rw,
    readonlyPaths: policy.extraReadonlyPaths.map(norm),
    deniedPaths: policy.extraDeniedPaths.map(norm),
  };
}

/** Normalize a path: absolutize, run realpath when possible, lower-case on Windows. */
export function normalizePath(p: string): string {
  let abs = path.isAbsolute(p) ? p : path.resolve(p);
  abs = path.resolve(abs);  // collapse ., ..

  // realpath canonicalizes symlinks/junctions and resolves Windows short (8.3) names.
  // For a not-yet-existing path, realpath fails; in that case, realpath the deepest
  // existing ancestor and re-append the un-existing tail. This matters on Windows
  // where tmpdir() may return short names like "PNIKOLE~1".
  try {
    abs = fs.realpathSync.native(abs);
  } catch {
    let cursor = abs;
    const tail: string[] = [];
    // Walk up until we find an existing ancestor.
    while (cursor && cursor !== path.dirname(cursor)) {
      try {
        const real = fs.realpathSync.native(cursor);
        abs = path.join(real, ...tail.reverse());
        return IS_WINDOWS ? abs.toLowerCase() : abs;
      } catch {
        tail.push(path.basename(cursor));
        cursor = path.dirname(cursor);
      }
    }
    // No ancestor exists (extremely unlikely); fall through to lower-cased abs.
  }
  return IS_WINDOWS ? abs.toLowerCase() : abs;
}

/** True if `a` and `b` resolve to the same path on this OS. */
export function samePath(a: string, b: string): boolean {
  return IS_WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Returns true when `target` is inside `parent` (or equal to it). Uses
 * `path.relative` so we don't false-match on prefix overlaps like
 * `C:\foo` vs `C:\foobar`.
 */
export function isPathInside(target: string, parent: string): boolean {
  if (!parent) return false;
  if (samePath(target, parent)) return true;
  const rel = path.relative(parent, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export type PathScopeResult =
  | { decision: 'allow-rw' }
  | { decision: 'allow-ro' }
  | { decision: 'deny'; reason: 'denied-list' | 'out-of-scope' };

/**
 * Decide whether a tool call targeting `target` should be allowed under the
 * resolved policy. Returns:
 *  - allow-rw if target is inside any readwrite path (and not denied)
 *  - allow-ro if target is inside any readonly path (and not denied)
 *  - deny otherwise (out of scope or explicitly denied)
 *
 * `requiresWrite` lets read-only callers (view/glob/grep) pass an RO path.
 */
export function checkPathScope(
  target: string,
  policy: ResolvedPathPolicy,
  requiresWrite: boolean,
): PathScopeResult {
  const t = normalizePath(target);

  // Denied list always wins.
  for (const denied of policy.deniedPaths) {
    if (isPathInside(t, denied)) {
      return { decision: 'deny', reason: 'denied-list' };
    }
  }

  for (const rw of policy.readwritePaths) {
    if (isPathInside(t, rw)) return { decision: 'allow-rw' };
  }

  if (!requiresWrite) {
    for (const ro of policy.readonlyPaths) {
      if (isPathInside(t, ro)) return { decision: 'allow-ro' };
    }
  }

  return { decision: 'deny', reason: 'out-of-scope' };
}

/**
 * Convenience: true if the target may be accessed (read or write per
 * `requiresWrite`) under the policy.
 */
export function isPathInScope(
  target: string,
  policy: ResolvedPathPolicy,
  requiresWrite: boolean,
): boolean {
  const r = checkPathScope(target, policy, requiresWrite);
  return r.decision === 'allow-rw' || r.decision === 'allow-ro';
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-tool path hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapping of tool names → (toolArgs) => { paths, requiresWrite }.
 * Each entry knows how to extract the path-like arguments and whether the
 * operation writes (e.g., `edit`, `create`) or reads (e.g., `view`, `glob`).
 *
 * Tool names follow the runtime's split-tool taxonomy
 * (see copilot-agent-runtime/src/agents/toolAliases.ts).
 */
type PathExtractor = (args: Record<string, unknown>) => { paths: string[]; requiresWrite: boolean } | null;

const PATH_EXTRACTORS: Record<string, PathExtractor> = {
  view: (a) => stringArg(a.path).map(p => ({ paths: [p], requiresWrite: false })) ?? null,
  show_file: (a) => stringArg(a.path).map(p => ({ paths: [p], requiresWrite: false })) ?? null,
  edit: (a) => stringArg(a.path).map(p => ({ paths: [p], requiresWrite: true })) ?? null,
  create: (a) => stringArg(a.path).map(p => ({ paths: [p], requiresWrite: true })) ?? null,
  apply_patch: (a) => {
    // apply_patch's input typically contains a diff string; we can't easily
    // extract paths without parsing. Skip enforcement here — the runtime fires
    // a write permission per file, which our path-aware perm handler catches.
    void a;
    return null;
  },
  str_replace_editor: (a) => {
    const cmd = typeof a.command === 'string' ? a.command : '';
    const p = typeof a.path === 'string' ? a.path : '';
    if (!p) return null;
    const isWrite = cmd === 'create' || cmd === 'edit' || cmd === 'insert' || cmd === 'undo_edit';
    return { paths: [p], requiresWrite: isWrite };
  },
  glob: (a) => {
    const candidates: string[] = [];
    if (typeof a.paths === 'string') candidates.push(a.paths);
    else if (Array.isArray(a.paths)) {
      for (const x of a.paths) if (typeof x === 'string') candidates.push(x);
    }
    if (!candidates.length) return null;
    return { paths: candidates, requiresWrite: false };
  },
  grep: (a) => {
    const candidates: string[] = [];
    if (typeof a.paths === 'string') candidates.push(a.paths);
    else if (Array.isArray(a.paths)) {
      for (const x of a.paths) if (typeof x === 'string') candidates.push(x);
    }
    if (!candidates.length) return null;
    return { paths: candidates, requiresWrite: false };
  },
};

/** Helper: convert a string|undefined into an Option<string> we can map over. */
function stringArg(v: unknown): { map: <T>(f: (s: string) => T) => T | null } {
  return {
    map: <T>(f: (s: string) => T): T | null => (typeof v === 'string' && v ? f(v) : null),
  };
}

/**
 * Result of the path-policy pre-tool hook callback. Mirrors
 * `PreToolUseHookOutput` from the SDK so callers can return it directly.
 */
export interface PathPolicyHookResult {
  permissionDecision?: 'allow' | 'deny' | 'ask';
  permissionDecisionReason?: string;
}

/**
 * Build a path-policy pre-tool hook that:
 *  1. Runs the existing read-only shell classifier as defense-in-depth.
 *  2. For path-bearing tools (view/edit/create/glob/grep/str_replace_editor),
 *     extracts the paths and checks them against the policy. Out-of-scope
 *     paths trigger `onBlock` (which should emit a sandbox block + await user
 *     decision) and the hook returns the resolved decision.
 *  3. For `web_fetch`: when policy.allowWebFetch is false and the URL hasn't
 *     been added to the per-agent allow list, triggers onBlock.
 *
 * `onBlock` returns the SDK PreToolUseHookOutput shape (allow/deny/ask). It
 * is also called with a `layer` so the bubble-up + logs can identify which
 * guard fired (`host:readonly-classifier`, `host:path-policy`, `host:web-fetch`).
 */export function createSandboxPathPolicyHook(args: {
  policy: ResolvedPathPolicy;
  /** When true, the legacy read-only classifier is skipped (caller does its own shell handling). */
  skipReadOnlyClassifier?: boolean;
  /** When false, web_fetch is allowed without asking. */
  allowWebFetch: boolean;
  /** When true, the agent has been opted out of the sandbox mid-session. */
  isDisabled: () => boolean;
  /** Per-agent host allow lists; consulted before triggering onBlock. */
  allowList: () => { paths: Set<string>; resources: Set<string>; webFetch: boolean };
  /** Bubble-up callback. Resolves to a final SDK decision. */
  onBlock: (info: {
    toolName: string;
    kind: 'read' | 'write' | 'web-fetch' | 'shell';
    target: string;
    requiresWrite: boolean;
    layer: SandboxLayer;
  }) => Promise<PathPolicyHookResult>;
}) {
  const readOnlyHook = createSandboxPreToolHook();

  return async (
    input: { toolName: string; toolArgs: unknown },
    invocation?: { sessionId: string },
  ): Promise<PathPolicyHookResult> => {
    if (args.isDisabled()) return {};

    const { toolName } = input;
    const toolArgs = (input.toolArgs ?? {}) as Record<string, unknown>;

    // 1. Defense-in-depth shell classifier
    if (!args.skipReadOnlyClassifier && (toolName === 'bash' || toolName === 'shell')) {
      const r = await readOnlyHook(input, invocation);
      if (r && r.permissionDecision === 'deny') {
        const a = (toolArgs.command as string | undefined) ?? '';
        logSandboxLayerDenial('host:readonly-classifier', {
          toolName,
          target: a,
          reason: 'non-read-only shell command in sandbox',
        });
        return r as PathPolicyHookResult;
      }
    }

    // 2. web_fetch — separate flow because it has no path
    if (toolName === 'web_fetch' || toolName === 'web-fetch') {
      const allowList = args.allowList();
      if (args.allowWebFetch || allowList.webFetch) return {};
      const url = typeof toolArgs.url === 'string' ? toolArgs.url : '';
      logSandboxLayerDenial('host:web-fetch', { toolName, target: url, reason: 'web_fetch denied by policy' });
      return args.onBlock({ toolName, kind: 'web-fetch', target: url, requiresWrite: false, layer: 'host:web-fetch' });
    }

    // 3. Path-bearing tools
    const extractor = PATH_EXTRACTORS[toolName];
    if (!extractor) return {};
    const extracted = extractor(toolArgs);
    if (!extracted) return {};

    const allowList = args.allowList();
    for (const target of extracted.paths) {
      if (allowList.paths.has(normalizePath(target))) continue;
      const result = checkPathScope(target, args.policy, extracted.requiresWrite);
      if (result.decision === 'allow-rw' || result.decision === 'allow-ro') continue;
      // Out of scope or denied — bubble up. First out-of-scope path wins.
      logSandboxLayerDenial('host:path-policy', {
        toolName,
        target,
        reason: result.decision === 'deny' ? result.reason : 'out-of-scope',
      });
      return args.onBlock({
        toolName,
        kind: extracted.requiresWrite ? 'write' : 'read',
        target,
        requiresWrite: extracted.requiresWrite,
        layer: 'host:path-policy',
      });
    }
    return {};
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-tool shell denial detector (heuristic / best-effort)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Heuristic patterns that suggest a shell command was denied by MXC.  Used by
 * the post-tool-use hook as a *soft* signal — the runtime currently surfaces
 * no structured `sandboxDenied` field, so we match strings.  Callers must
 * label the resulting prompt as "Possible sandbox denial" and offer an
 * "Ignore" option.
 *
 * See docs/mxc-sandbox-flow.md ("Known gaps") for context.
 */
const MXC_DENIAL_PATTERNS = [
  /access\s+is\s+denied/i,
  /access\s+denied/i,
  /permission\s+denied/i,
  /operation\s+not\s+permitted/i,
  /\bwxc[-_]exec\b/i,
  /lxc[-_]exec/i,
  /sandbox(ed)?\s+(denial|denied|violation|policy)/i,
  // Windows NTSTATUS for STATUS_ACCESS_DENIED
  /0x[cC]0000022/,
];

/**
 * Inspect a finished shell tool result for MXC-style denial markers.
 * Returns null when no markers found.  Otherwise returns a hint that the
 * caller can surface to the user via emitSandboxBlock.
 *
 * NOTE: This is best-effort.  It will produce false positives for normal
 * "permission denied" failures (e.g., reading a file the user themselves
 * lacks access to).  The UI must label the prompt accordingly.
 */
export function detectShellSandboxDenial(input: {
  toolName: string;
  toolArgs: unknown;
  toolResult: unknown;
}): { command: string; matchedPattern: string } | null {
  if (input.toolName !== 'bash' && input.toolName !== 'shell') return null;

  const args = (input.toolArgs ?? {}) as Record<string, unknown>;
  const command = typeof args.command === 'string' ? args.command : '';

  // Result text may live in result.content / result.detailedContent / result.text / etc.
  let text = '';
  if (typeof input.toolResult === 'string') {
    text = input.toolResult;
  } else if (input.toolResult && typeof input.toolResult === 'object') {
    const r = input.toolResult as Record<string, unknown>;
    text = [r.content, r.detailedContent, r.text, r.error, r.stderr]
      .filter((v) => typeof v === 'string')
      .join('\n');
  }
  if (!text) return null;

  for (const re of MXC_DENIAL_PATTERNS) {
    const m = text.match(re);
    if (m) return { command, matchedPattern: m[0] };
  }
  return null;
}

/**
 * Create a post-tool-use hook that detects MXC denials in shell results and
 * emits a sandbox block via `onBlock` (best-effort).
 *
 * Unlike `createSandboxPathPolicyHook`, this does not pause the tool call —
 * by the time `onPostToolUse` fires, the shell has already returned its
 * result.  We surface the bubble-up to give the user a chance to disable the
 * sandbox / allow once before the agent moves on.
 */
export function createSandboxShellDenialHook(args: {
  isDisabled: () => boolean;
  onBlock: (info: {
    toolName: string;
    target: string;
    matchedPattern: string;
    layer: SandboxLayer;
  }) => Promise<unknown>;
}) {
  return async (input: { toolName: string; toolArgs: unknown; toolResult: unknown }, _invocation?: { sessionId: string }) => {
    if (args.isDisabled()) return undefined;
    const hit = detectShellSandboxDenial(input);
    if (!hit) return undefined;
    logSandboxLayerDenial('mxc:shell-denial-suspected', {
      toolName: input.toolName,
      target: hit.command,
      reason: `matched pattern "${hit.matchedPattern}"`,
    });
    // Fire-and-forget: we don't block the runtime here, since the tool call
    // already finished. The bubble-up runs asynchronously; the user may resolve
    // it before or after the agent's next turn.
    void args.onBlock({
      toolName: input.toolName,
      target: hit.command,
      matchedPattern: hit.matchedPattern,
      layer: 'mxc:shell-denial-suspected',
    });
    return undefined;
  };
}
