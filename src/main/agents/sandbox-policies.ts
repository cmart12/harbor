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
// Post-tool shell denial detector (tiered, based on copilot-agent-runtime)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Confidence level of a detected sandbox-related failure.
 *
 * - `high`: output explicitly mentions a sandbox blocking something
 *   (e.g. macOS Seatbelt, MXC wxc-exec, explicit sandbox deny/block).
 * - `medium`: a generic permission error (`Permission denied`, `EACCES`, …)
 *   accompanied by a non-zero exit code. Hedged — may be a real host error.
 * - `network`: a network-failure fingerprint while the sandbox restricts
 *   outbound traffic.
 */
export type SandboxDenialKind = 'high' | 'medium' | 'network';

export interface SandboxDenialHint {
  kind: SandboxDenialKind;
  /** Substring of output that triggered the match. */
  matched: string;
}

/** Maximum bytes of output to scan (tail-only). */
export const SANDBOX_DENIAL_SCAN_BYTES = 16 * 1024;

const HIGH_CONFIDENCE_PATTERNS: ReadonlyArray<RegExp> = [
  // macOS Seatbelt user-space message.
  /file system sandbox blocked/i,
  // macOS Seatbelt kernel violation log: `Sandbox: bash(1234) deny ...`.
  /\bsandbox:\s+\S+\(\d+\)\s+deny\b/i,
  // Catch-all: "sandbox" near a denial verb.
  /\bsandbox\b[^.\n]{0,80}\b(?:block(?:ed|s|ing)?|den(?:y|ied|ies|ying))\b/i,
  // MXC/wxc-exec and lxc-exec markers (whim-specific, carried forward).
  /\bwxc[-_]exec\b/i,
  /lxc[-_]exec/i,
  // Windows NTSTATUS for STATUS_ACCESS_DENIED (MXC AppContainer).
  /0x[cC]0000022/,
  // SDK-emitted shell startup failure. The Copilot SDK throws
  // `new Error(\`Failed to start ${shellType} process\`)` when its shell
  // wrapper (bash / powershell / pwsh / zsh / sh) can't be spawned. Inside
  // an active sandbox session this overwhelmingly means MXC's AppContainer
  // blocked the shell binary from launching at all. Outside a sandbox we'd
  // never see this hook fire (createSandboxShellDenialHook is only wired
  // when persona.sandboxed === true, and bypasses via isDisabled()), so a
  // false positive is structurally not possible here.
  /failed to start (?:bash|powershell|pwsh|zsh|sh|cmd|local[_-]shell) process/i,
];

const MEDIUM_CONFIDENCE_PATTERNS: ReadonlyArray<RegExp> = [
  /\bpermission denied\b/i,
  /\boperation not permitted\b/i,
  /\baccess (?:is )?denied\b/i,
  /\bEACCES\b/,
  /\bEPERM\b/,
  // Windows ACCESS_DENIED HRESULT.
  /0x80070005\b/i,
];

const NETWORK_PATTERNS: ReadonlyArray<RegExp> = [
  /could not resolve host/i,
  /temporary failure in name resolution/i,
  /name or service not known/i,
  /network is unreachable/i,
  /no route to host/i,
  /\bconnection refused\b/i,
  // curl exit-style messages.
  /curl:\s*\(\d+\)\s+(?:could not resolve|couldn't resolve|failed to connect)/i,
  // PowerShell / .NET HttpRequestException flavours.
  /the remote name could not be resolved/i,
];

/**
 * The set of tool names the Copilot SDK uses to execute shell commands.
 * Matched case-insensitively in `detectShellSandboxDenial`. The SDK exposes
 * both single-shot (`bash`, `powershell`, `shell`, `local_shell`) and
 * managed-shell (`write_bash`, `write_powershell`, etc.) variants — both
 * surface failures through the post-tool hook and both need to fingerprint
 * sandbox denials.
 *
 * Source: `@github/copilot/sdk/index.js` shell tool registry — the
 * shellToolName + read/write/stop/list variants. See `node_modules/@github
 * /copilot/sdk/index.js` `t("bash", ...)` and `t("powershell", ...)` calls.
 */
const SHELL_TOOL_NAME_REGEX = /^(?:bash|shell|powershell|pwsh|local[_-]shell|(?:read|write|stop|list)_(?:bash|shell|powershell|pwsh))$/i;

/**
 * Returns true when `toolName` is one of the SDK's shell-execution tools.
 * Exported for the tests.
 */
export function isShellToolName(toolName: string): boolean {
  return SHELL_TOOL_NAME_REGEX.test(toolName);
}

function firstMatch(text: string, patterns: ReadonlyArray<RegExp>): string | undefined {
  for (const pattern of patterns) {
    const m = pattern.exec(text);
    if (m) return m[0];
  }
  return undefined;
}

/** Extract the exit code from embedded `<exited with exit code N>` text. */
export function extractExitCode(text: string): number | undefined {
  // Prefer a structured exitCode field passed through the SDK result object
  // before falling back to the text-embedded pattern.
  const m = text.match(/<exited with exit code (\d+)>/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Inspect a finished shell tool result for fingerprints suggesting the
 * failure was caused by the active sandbox policy. Returns null when the
 * output is empty or no fingerprint matches.
 *
 * Tiered detection (mirrors copilot-agent-runtime sandboxDenialDetector):
 *  - `high` patterns fire regardless of exit code.
 *  - `medium` and `network` only fire on non-zero exit codes to reduce
 *    false positives (e.g. `find` printing "Permission denied" but exiting 0).
 *  - `network` only fires when `allowOutbound` is false.
 */
export function detectShellSandboxDenial(input: {
  toolName: string;
  toolArgs: unknown;
  toolResult: unknown;
  /** Whether the sandbox allows outbound network. When true, network
   *  patterns are skipped (they wouldn't be sandbox-caused). */
  allowOutbound?: boolean;
}): SandboxDenialHint | null {
  if (!isShellToolName(input.toolName)) return null;

  let text = '';
  if (typeof input.toolResult === 'string') {
    text = input.toolResult;
  } else if (input.toolResult && typeof input.toolResult === 'object') {
    const r = input.toolResult as Record<string, unknown>;
    // SDK ToolResultObject has textResultForLlm; also check legacy fields.
    text = [r.textResultForLlm, r.content, r.detailedContent, r.text, r.error, r.stderr]
      .filter((v) => typeof v === 'string')
      .join('\n');
  }
  if (!text) return null;

  // Scan only the tail (denial messages appear near the point of failure).
  const scanText = text.length > SANDBOX_DENIAL_SCAN_BYTES
    ? text.slice(-SANDBOX_DENIAL_SCAN_BYTES)
    : text;

  // High confidence: fire regardless of exit code.
  const highMatch = firstMatch(scanText, HIGH_CONFIDENCE_PATTERNS);
  if (highMatch) return { kind: 'high', matched: highMatch };

  // Medium and network only fire for actual failures.
  const exitCode = extractExitCode(text);
  if (exitCode === 0 || exitCode === undefined) return null;

  // Network patterns only apply when outbound is restricted.
  if (input.allowOutbound === false) {
    const networkMatch = firstMatch(scanText, NETWORK_PATTERNS);
    if (networkMatch) return { kind: 'network', matched: networkMatch };
  }

  const mediumMatch = firstMatch(scanText, MEDIUM_CONFIDENCE_PATTERNS);
  if (mediumMatch) return { kind: 'medium', matched: mediumMatch };

  return null;
}

/**
 * Build the LLM-facing footer appended to the tool result when a denial is
 * detected. Wording varies by confidence: high/network are definitive,
 * medium is hedged.
 */
export function formatSandboxDenialFooter(hint: SandboxDenialHint): string {
  switch (hint.kind) {
    case 'high':
      return (
        '<sandbox is active and blocked this command. ' +
        'Do not attempt workarounds (alternative paths, retries, fallback tools). ' +
        'If this command needs broader access, ask the user to update their sandbox policy in Settings (paths, network).>'
      );
    case 'network':
      return (
        '<sandbox is active and outbound network access is currently restricted by policy. ' +
        'Do not attempt workarounds. ' +
        'If this command needs network access, ask the user to enable outbound access in their sandbox settings.>'
      );
    case 'medium':
      return (
        '<this failure may be caused by the active sandbox policy. ' +
        'Do not attempt workarounds. ' +
        'If you suspect the sandbox blocked this, ask the user to review their sandbox policy in Settings (paths, network).>'
      );
  }
}

/** Map denial kind to a SandboxLayer tag for logging and UI. */
function denialKindToLayer(kind: SandboxDenialKind): SandboxLayer {
  switch (kind) {
    case 'high': return 'mxc:shell-denial-high';
    case 'medium': return 'mxc:shell-denial-medium';
    case 'network': return 'mxc:shell-denial-network';
  }
}

/**
 * Create a post-tool-use hook that detects sandbox denials in shell results.
 *
 * Two effects:
 *  1. Emits a bubble-up block notification to the UI (fire-and-forget).
 *  2. Returns `modifiedResult` with the denial footer appended so the LLM
 *     stops retrying and asks the user to adjust their policy.
 */
export function createSandboxShellDenialHook(args: {
  isDisabled: () => boolean;
  allowOutbound: () => boolean;
  onBlock: (info: {
    toolName: string;
    target: string;
    matchedPattern: string;
    kind: SandboxDenialKind;
    layer: SandboxLayer;
  }) => Promise<unknown>;
}) {
  return async (input: { toolName: string; toolArgs: unknown; toolResult: unknown }, _invocation?: { sessionId: string }) => {
    if (args.isDisabled()) return undefined;

    const hint = detectShellSandboxDenial({
      ...input,
      allowOutbound: args.allowOutbound(),
    });
    if (!hint) return undefined;

    const toolArgs = (input.toolArgs ?? {}) as Record<string, unknown>;
    const command = typeof toolArgs.command === 'string' ? toolArgs.command : '';
    const layer = denialKindToLayer(hint.kind);

    logSandboxLayerDenial(layer, {
      toolName: input.toolName,
      target: command,
      reason: `[${hint.kind}] matched "${hint.matched}"`,
    });

    // Bubble-up to user (fire-and-forget).
    void args.onBlock({
      toolName: input.toolName,
      target: command,
      matchedPattern: hint.matched,
      kind: hint.kind,
      layer,
    });

    // Append footer to the tool result so the LLM sees it.
    const footer = formatSandboxDenialFooter(hint);
    const result = input.toolResult;
    if (result && typeof result === 'object' && 'textResultForLlm' in result) {
      // SDK ToolResultObject — return modifiedResult with footer.
      const orig = result as { textResultForLlm: string; [k: string]: unknown };
      return {
        modifiedResult: {
          ...orig,
          textResultForLlm: `${orig.textResultForLlm}\n\n${footer}`,
        },
      };
    }
    // Legacy string result — return additionalContext as fallback.
    return { additionalContext: footer };
  };
}
