import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

const INTENT_DIR = '.intent';
const LOG_FILE = 'events.jsonl';
const DB_FILE = 'intents.db';

const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

export function getIntentDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, INTENT_DIR);
}

export function getLogPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, INTENT_DIR, LOG_FILE);
}

export function getDbPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, INTENT_DIR, DB_FILE);
}

/** Ensure the .intent/ directory and .gitignore entries exist in the workspace. */
export function initWorkspace(rootPath: string): void {
  const intentDir = getIntentDir(rootPath);
  if (!fs.existsSync(intentDir)) {
    fs.mkdirSync(intentDir, { recursive: true });
  }

  const gitignorePath = path.join(rootPath, '.gitignore');
  const requiredEntries = [
    '.intent/*.db',
    '.intent/*.db-journal',
    '.intent/*.db-wal',
    '.intent/*.db-shm',
  ];

  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf-8');
  }

  const missing = requiredEntries.filter(entry => !existing.includes(entry));
  if (missing.length > 0) {
    const nl = existing && !existing.endsWith('\n') ? '\n' : '';
    const addition = `${nl}# Intent app local cache\n${missing.join('\n')}\n`;
    fs.appendFileSync(gitignorePath, addition);
  }
}

/** Generate a filesystem-safe slug from a description, with intent ID suffix for uniqueness. */
export function slugify(text: string, intentId: string): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (slug.length > 60) {
    slug = slug.substring(0, 60).replace(/-$/, '');
  }

  // Guard against Windows reserved names
  const firstSegment = slug.split('-')[0];
  if (RESERVED_NAMES.has(firstSegment)) {
    slug = 'intent-' + slug;
  }

  const idSuffix = intentId.replace(/-/g, '').substring(0, 4);
  return slug ? `${slug}-${idSuffix}` : idSuffix;
}

/** Create a subfolder for an intent inside the workspace. Returns the folder name (relative). */
export function createIntentFolder(workspaceRoot: string, intentId: string, description: string): string {
  const folder = slugify(description, intentId);
  const folderPath = path.join(workspaceRoot, folder);

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  return folder;
}

const CANVAS_FILE = 'canvas.md';

/** Get the absolute path to an intent's canvas file. */
export function getCanvasPath(workspaceRoot: string, folder: string): string {
  return path.join(workspaceRoot, folder, CANVAS_FILE);
}

/** Read the canvas content for an intent. Returns empty string if file doesn't exist. */
export function readCanvas(workspaceRoot: string, folder: string): string {
  const canvasPath = getCanvasPath(workspaceRoot, folder);
  if (!fs.existsSync(canvasPath)) return '';
  return fs.readFileSync(canvasPath, 'utf-8');
}

/** Write content to an intent's canvas file. Creates the folder if needed. */
export function writeCanvas(workspaceRoot: string, folder: string, content: string): void {
  const folderPath = path.join(workspaceRoot, folder);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  const canvasPath = getCanvasPath(workspaceRoot, folder);
  fs.writeFileSync(canvasPath, content, 'utf-8');
}

/** Create an intent's folder and seed its canvas with initial content. */
export function initIntentCanvas(workspaceRoot: string, intentId: string, description: string, body: string | null): string {
  const folder = createIntentFolder(workspaceRoot, intentId, description);
  const canvasPath = getCanvasPath(workspaceRoot, folder);

  // Only seed if canvas doesn't already exist
  if (!fs.existsSync(canvasPath)) {
    const content = body && body.trim() ? body.trim() + '\n' : '';
    fs.writeFileSync(canvasPath, content, 'utf-8');
  }

  return folder;
}

// ── Auto-commit ─────────────────────────────────────────

let commitTimer: ReturnType<typeof setTimeout> | null = null;
let commitInFlight = false;
const COMMIT_DEBOUNCE_MS = 2000;

function runGit(workspaceRoot: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: workspaceRoot, timeout: 10000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function doCommit(workspaceRoot: string): Promise<void> {
  if (commitInFlight) return;
  commitInFlight = true;
  try {
    // Check if this is a git repo
    await runGit(workspaceRoot, ['rev-parse', '--git-dir']);

    // Stage the .intent/ dir (event log) and all tracked/new files (intent folders)
    await runGit(workspaceRoot, ['add', '-A']);

    // Check if there's anything to commit
    try {
      await runGit(workspaceRoot, ['diff', '--cached', '--quiet']);
      // No changes staged — nothing to commit
      return;
    } catch {
      // diff --quiet exits non-zero when there ARE changes — that's what we want
    }

    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    await runGit(workspaceRoot, ['commit', '-m', `intent: auto-save ${timestamp}`, '--no-verify']);
    console.log(`[workspace] Auto-committed at ${timestamp}`);
  } catch (err: any) {
    // Silently skip if not a git repo or git not available
    if (err?.message?.includes('not a git repository') || err?.code === 'ENOENT') {
      return;
    }
    console.warn('[workspace] Auto-commit failed:', err?.message || err);
  } finally {
    commitInFlight = false;
  }
}

/**
 * Schedule an auto-commit for the workspace. Debounced so rapid changes
 * (typing, canvas saves, multiple intent updates) coalesce into one commit.
 */
export function scheduleAutoCommit(workspaceRoot: string): void {
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    commitTimer = null;
    doCommit(workspaceRoot);
  }, COMMIT_DEBOUNCE_MS);
}
