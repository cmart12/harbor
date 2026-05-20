import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getSpace, assignSpaceFolder } from './database';
import { getSessionId, setSessionId as configSetSessionId, getConfigValue } from './config';
import { setSpaceSessionId } from './database';
import { createSpaceFolder } from './workspace';
import { launchInTerminal as platformLaunchInTerminal } from './platform/terminal';
import { focusTerminalWindow } from './platform/focus';

// Per-space launch lock to prevent duplicate terminals
const launching = new Set<string>();

// Track running terminal processes: spaceId → session info
interface TrackedSession {
  pid: number | null;
  sessionId: string;
}
const runningProcesses = new Map<string, TrackedSession>();

let resolvedCliPath: string | null = null;
let cliResolved = false;

// ── CLI version compatibility ───────────────────────────

export const MIN_CLI_VERSION = '1.0.36';

let resolvedCliVersion: string | null = null;
let cliVersionResolved = false;

export interface CliVersionInfo {
  path: string | null;
  version: string | null;
  compatible: boolean;
  minVersion: string;
}

/** Parse a version string from `copilot --version` output (e.g. "GitHub Copilot CLI 1.0.36.") */
export function parseCliVersion(output: string): string | null {
  const match = output.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Compare two semver-like version strings.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** Detect the CLI version by running `<cli> --version`. Result is cached. */
export function getCopilotCliVersion(): string | null {
  if (cliVersionResolved) return resolvedCliVersion;
  cliVersionResolved = true;

  const cliPath = resolveCopilotCliPath();
  if (!cliPath) {
    resolvedCliVersion = null;
    return null;
  }

  try {
    // On Windows, .js files can't be executed directly (they open in Notepad
    // or Windows Script Host). Run them via the current Node/Electron binary.
    const cmd = /\.js$/i.test(cliPath)
      ? `"${process.execPath}" "${cliPath}" --version`
      : `"${cliPath}" --version`;
    const output = execSync(cmd, {
      timeout: 10_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    resolvedCliVersion = parseCliVersion(output);
    if (resolvedCliVersion) {
      console.log(`[session] CLI version: ${resolvedCliVersion}`);
    } else {
      console.warn(`[session] Could not parse CLI version from: ${output}`);
    }
  } catch (err) {
    console.warn('[session] Failed to get CLI version:', err);
    resolvedCliVersion = null;
  }

  return resolvedCliVersion;
}

/** Full compatibility check — returns path, version, and whether the version meets the minimum. */
export function checkCliCompatibility(): CliVersionInfo {
  const cliPath = resolveCopilotCliPath();
  const version = getCopilotCliVersion();
  const compatible = version != null && (version === '0.0.1' || compareVersions(version, MIN_CLI_VERSION) >= 0);
  return { path: cliPath, version, compatible, minVersion: MIN_CLI_VERSION };
}

let resolvedMxcCapable: boolean | null = null;
let mxcCapableResolved = false;

/**
 * Reset cached mxc-capability probe. Called whenever cliPath changes.
 * @internal — exported for invalidateCliPath() to chain into.
 */
export function invalidateMxcCapability(): void {
  resolvedMxcCapable = null;
  mxcCapableResolved = false;
}

/**
 * Best-effort probe: returns true if the resolved CLI ships with
 * `@microsoft/mxc-sdk` in its node_modules. Used to surface a warning when a
 * sandboxed persona is launched against a CLI that can't enforce MXC.
 *
 * Walks up from `dirname(cliPath)` checking `<dir>/node_modules/@microsoft/mxc-sdk`
 * at every level (up to a bounded depth). This handles all real layouts:
 *   - bundled CLI (`<repo>/dist-cli/index.js`, deps in `<repo>/node_modules`),
 *   - hoisted npm install (`<prefix>/node_modules/@github/copilot/index.js`,
 *     deps in `<prefix>/node_modules`),
 *   - nested install (`@github/copilot/node_modules/@microsoft/mxc-sdk`).
 *
 * Result is cached; cleared on cliPath change via `invalidateMxcCapability`.
 */
export function isCliMxcCapable(): boolean {
  if (mxcCapableResolved) return resolvedMxcCapable === true;
  mxcCapableResolved = true;
  resolvedMxcCapable = false;

  const cliPath = resolveCopilotCliPath();
  if (!cliPath) return false;

  const MAX_DEPTH = 8;
  const searched: string[] = [];
  let dir = path.dirname(cliPath);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const mxcSdkDir = path.join(dir, 'node_modules', '@microsoft', 'mxc-sdk');
    searched.push(mxcSdkDir);
    if (fs.existsSync(mxcSdkDir)) {
      resolvedMxcCapable = true;
      return true;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  console.warn(
    `[session] MXC probe: @microsoft/mxc-sdk not found near ${cliPath}. Searched:\n  ${searched.join('\n  ')}`,
  );
  return false;
}

export interface LaunchResult {
  success: boolean;
  error?: string;
  sessionId?: string;
}

// ── CLI discovery ───────────────────────────────────────

/**
 * Resolve a bare command name (e.g. "copilot", "copilot-dev") to its full
 * path using the system PATH via `where.exe` (Windows) or `which` (Unix).
 */
export function resolveCommandOnPath(command: string): string | null {
  try {
    const cmd = process.platform === 'win32' ? `where.exe ${command}` : `which ${command}`;
    const result = execSync(cmd, { windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const lines = result.split(/\r?\n/).filter(Boolean);

    if (process.platform === 'win32') {
      // Prefer .cmd files on Windows (Node can't spawn bare Unix shell scripts)
      const cmdLine = lines.find(l => /\.cmd$/i.test(l));
      if (cmdLine && fs.existsSync(cmdLine)) return cmdLine;
    }

    // Return first valid result
    const first = lines[0];
    if (first && fs.existsSync(first)) return first;
  } catch {
    // Command not found on PATH
  }
  return null;
}

/**
 * On Windows, .cmd wrappers cannot be spawned directly by the Copilot SDK
 * (it uses spawn() without shell:true, causing EINVAL). Resolve to the
 * underlying @github/copilot/index.js entry point in the same npm prefix,
 * which the SDK can spawn via process.execPath.
 *
 * We use index.js (the full CLI bundle) rather than npm-loader.js because
 * the loader checks for a platform-specific native binary and Node >= 24,
 * both of which fail under Electron's runtime.
 */
export function resolveCmdToJs(cmdPath: string): string {
  if (process.platform !== 'win32' || !/\.cmd$/i.test(cmdPath)) return cmdPath;

  try {
    const dir = path.dirname(cmdPath);

    // Case 1: Global npm prefix (e.g. C:\ProgramData\npm\copilot.cmd)
    // Package is at <prefix>\node_modules\@github\copilot\index.js
    const globalJs = path.join(dir, 'node_modules', '@github', 'copilot', 'index.js');
    if (fs.existsSync(globalJs)) return globalJs;

    // Case 2: Local node_modules\.bin\copilot.cmd
    // Package is at <project>\node_modules\@github\copilot\index.js
    if (path.basename(dir) === '.bin') {
      const localJs = path.join(path.dirname(dir), '@github', 'copilot', 'index.js');
      if (fs.existsSync(localJs)) return localJs;
    }
  } catch {
    // Fall through to return original
  }

  return cmdPath;
}

function autoDetectCopilotCli(): string | null {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.APPDATA || '', 'npm', 'copilot.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'npm', 'copilot.cmd'),
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'npm', 'copilot.cmd'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return resolveCmdToJs(p);
    }
  }

  // macOS/Linux: check common paths
  if (process.platform !== 'win32') {
    const home = process.env.HOME || '';
    const candidates = [
      '/usr/local/bin/copilot',
      '/opt/homebrew/bin/copilot',
      path.join(home, '.npm-global', 'bin', 'copilot'),
      path.join(home, '.nvm', 'current', 'bin', 'copilot'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }

  try {
    const cmd = process.platform === 'win32' ? 'where.exe copilot' : 'which copilot';
    const result = execSync(cmd, { windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const lines = result.split(/\r?\n/).filter(Boolean);

    // Skip node_modules shims — we want the real globally-installed CLI,
    // not the local project shim that npm puts on PATH during `npm run`.
    const isGlobal = (l: string) => !l.includes('node_modules');

    if (process.platform === 'win32') {
      // On Windows, prefer .cmd files — bare "copilot" entries are Unix shell
      // scripts that Node's spawn() cannot execute (ENOENT).
      const cmdLine = lines.find(l => /\.cmd$/i.test(l) && isGlobal(l));
      if (cmdLine && fs.existsSync(cmdLine)) return resolveCmdToJs(cmdLine);
    }

    const globalLine = lines.find(l => isGlobal(l));
    if (globalLine && fs.existsSync(globalLine)) return globalLine;
  } catch {
    // Not found
  }

  return null;
}

/**
 * Resolve the effective Copilot CLI path.
 * Priority: user config override → auto-detect.
 * Result is cached; call invalidateCliPath() to reset after config changes.
 */
export function resolveCopilotCliPath(): string | null {
  if (cliResolved) return resolvedCliPath;
  cliResolved = true;

  const override = getConfigValue('cliPath');
  if (override) {
    // If it's a full path that exists, use it directly
    if (fs.existsSync(override)) {
      resolvedCliPath = resolveCmdToJs(override);
      console.log(`[session] Using configured CLI path: ${resolvedCliPath}`);
      return resolvedCliPath;
    }

    // Otherwise try to resolve the command name via PATH (where/which)
    const resolved = resolveCommandOnPath(override);
    if (resolved) {
      resolvedCliPath = resolveCmdToJs(resolved);
      console.log(`[session] Resolved configured CLI "${override}" to: ${resolvedCliPath}`);
      return resolvedCliPath;
    }

    console.warn(`[session] Configured CLI path not found: ${override}, falling back to auto-detect`);
  }

  resolvedCliPath = autoDetectCopilotCli();
  if (resolvedCliPath) {
    console.log(`[session] Auto-detected CLI at: ${resolvedCliPath}`);
  } else {
    console.warn('[session] Copilot CLI not found');
  }
  return resolvedCliPath;
}

/** Clear cached CLI path and version so the next call re-resolves. */
export function invalidateCliPath(): void {
  cliResolved = false;
  resolvedCliPath = null;
  cliVersionResolved = false;
  resolvedCliVersion = null;
  invalidateMxcCapability();
}

/** @deprecated Use resolveCopilotCliPath() instead */
export async function checkCopilotCli(): Promise<string | null> {
  return resolveCopilotCliPath();
}

// ── Process tracking ────────────────────────────────────

/** Check if a process is still running by PID */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Check if a copilot session is running by searching for its resume arg */
function isSessionProcessRunning(sessionId: string): boolean {
  try {
    if (process.platform === 'win32') {
      const result = execSync(
        `wmic process where "CommandLine like '%--resume=${sessionId}%'" get ProcessId /format:list`,
        { windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
      ).toString();
      return result.includes('ProcessId=');
    } else {
      execSync(`pgrep -f "resume=${sessionId}"`, { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
      return true;
    }
  } catch {
    return false;
  }
}

/** Check if a tracked session is still running */
function isTrackedSessionAlive(tracked: TrackedSession): boolean {
  if (tracked.pid && isProcessAlive(tracked.pid)) return true;
  return isSessionProcessRunning(tracked.sessionId);
}

/** Get space IDs that have active running terminal processes */
export function getActiveSessionIntentIds(): string[] {
  const active: string[] = [];
  for (const [spaceId, tracked] of runningProcesses) {
    if (isTrackedSessionAlive(tracked)) {
      active.push(spaceId);
    } else {
      runningProcesses.delete(spaceId);
    }
  }
  return active;
}

// ── Window focus (delegated to platform adapter) ────────

// ── Launch / reactivate ─────────────────────────────────

export async function launchSessionInTerminal(sessionId: string, cwd: string, signalPath?: string): Promise<{ pid: number | null }> {
  const cli = await checkCopilotCli();
  if (!cli) throw new Error('Copilot CLI not found');

  const compat = checkCliCompatibility();
  if (!compat.compatible) {
    throw new Error(
      `Copilot CLI ${compat.version || 'unknown'} is not compatible. Please update to ${compat.minVersion} or later (run: copilot update).`
    );
  }

  const result = await platformLaunchInTerminal({
    command: cli,
    args: [`--resume=${sessionId}`],
    cwd,
    signalPath,
  });
  return { pid: result.pid ?? null };
}

export async function launchSession(spaceId: string, workspaceRoot: string): Promise<LaunchResult> {
  // Check if there's already a running process — bring it to foreground
  const existing = runningProcesses.get(spaceId);
  if (existing && isTrackedSessionAlive(existing)) {
    const focused = await focusTerminalWindow({
      title: existing.sessionId,
      pid: existing.pid ?? undefined,
    });
    if (focused) {
      console.log(`[session] Reactivated existing terminal for ${spaceId}`);
      return { success: true, sessionId: existing.sessionId };
    }
    // Process alive but couldn't focus — clear and relaunch
    runningProcesses.delete(spaceId);
  }

  // Launch lock
  if (launching.has(spaceId)) {
    return { success: false, error: 'Session is already launching' };
  }

  // Validate workspace
  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    return { success: false, error: 'Workspace directory does not exist' };
  }

  const cli = await checkCopilotCli();
  if (!cli) {
    return { success: false, error: 'Copilot CLI not found. Ensure it is installed and in your PATH.' };
  }

  const compat = checkCliCompatibility();
  if (!compat.compatible) {
    return {
      success: false,
      error: `Copilot CLI ${compat.version || 'unknown'} is not compatible. Please update to ${compat.minVersion} or later (run: copilot update).`,
    };
  }

  launching.add(spaceId);

  try {
    const space = getSpace(spaceId);
    if (!space) {
      return { success: false, error: 'Space not found' };
    }

    // Ensure the space has a workspace subfolder
    let folder = space.folder;
    if (!folder) {
      folder = createSpaceFolder(workspaceRoot, spaceId, space.description);
      assignSpaceFolder(spaceId, folder);
    }
    const cwd = path.join(workspaceRoot, folder);

    // Ensure folder exists (may have been deleted manually)
    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(cwd, { recursive: true });
    }

    // Resolve session ID from local config (per-machine)
    let sessionId = getSessionId(spaceId);
    if (!sessionId) {
      const { v4: uuidv4 } = require('uuid');
      sessionId = uuidv4() as string;
      configSetSessionId(spaceId, sessionId);
      setSpaceSessionId(spaceId, sessionId);
    }

    const result = await platformLaunchInTerminal({
      command: cli,
      args: [`--resume=${sessionId}`],
      cwd,
    });
    if (result.pid === undefined) {
      return { success: false, error: 'Failed to open terminal' };
    }

    // On macOS, resolve the real PID asynchronously (Terminal.app spawns async)
    if (process.platform === 'darwin' && result.pid === 0) {
      setTimeout(() => {
        try {
          const realPid = parseInt(
            execSync(`pgrep -nf "resume=${sessionId}"`, { timeout: 3000 }).toString().trim()
          );
          if (realPid) {
            const tracked = runningProcesses.get(spaceId);
            if (tracked && tracked.sessionId === sessionId) {
              tracked.pid = realPid;
            }
          }
        } catch { /* process may not have started yet */ }
      }, 2000);
    }

    runningProcesses.set(spaceId, { pid: result.pid, sessionId: sessionId! });
    console.log(`[session] Launched terminal for ${spaceId} in ${folder} (PID ${result.pid || 'unknown'})`);
    return { success: true, sessionId: sessionId! };
  } finally {
    setTimeout(() => launching.delete(spaceId), 2000);
  }
}
