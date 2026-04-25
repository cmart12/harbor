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
    '*/attachments/',
    '*/.workspace/',
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
const ATTACHMENTS_DIR = 'attachments';

const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25MB

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

function runGitOutput(workspaceRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: workspaceRoot, timeout: 10000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
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

// ── Git history ─────────────────────────────────────────

export interface FolderCommit {
  sha: string;
  shortSha: string;
  message: string;
  date: string;       // ISO 8601
  relativeDate: string;
  filesChanged: string[];
}

/** Get git commit history for an intent folder. */
export async function getIntentHistory(workspaceRoot: string, folder: string, limit = 50): Promise<FolderCommit[]> {
  try {
    const SEP = '---COMMIT---';
    const raw = await runGitOutput(workspaceRoot, [
      'log', `--max-count=${limit}`,
      '--format=' + [
        '%H',   // full sha
        '%h',   // short sha
        '%s',   // subject
        '%aI',  // author date ISO
        '%ar',  // relative date
      ].join('%x00'),
      '--name-only',
      '--diff-filter=ACDMR',
      '-z',    // null-delimit filenames
      '--', `${folder}/`,
    ]);

    if (!raw.trim()) return [];

    // Parse the log output. With -z and --name-only, the format is:
    // <format fields>\n\0file1\0file2\0\n<format fields>\n\0file1\0...
    // We split by the pattern: a line matching our 5-field format
    const commits: FolderCommit[] = [];
    const lines = raw.split('\n');
    let current: Partial<FolderCommit> | null = null;
    let fileBuffer: string[] = [];

    for (const line of lines) {
      const parts = line.split('\0').filter(p => p !== '');
      // Check if this line looks like a commit header (5 fields separated by \0)
      const headerParts = line.split('\0');
      if (headerParts.length >= 5 && /^[0-9a-f]{40}$/.test(headerParts[0])) {
        // Flush previous commit
        if (current?.sha) {
          commits.push({
            sha: current.sha!,
            shortSha: current.shortSha!,
            message: current.message!,
            date: current.date!,
            relativeDate: current.relativeDate!,
            filesChanged: fileBuffer.filter(f => f.startsWith(folder + '/')),
          });
        }
        current = {
          sha: headerParts[0],
          shortSha: headerParts[1],
          message: headerParts[2],
          date: headerParts[3],
          relativeDate: headerParts[4],
        };
        fileBuffer = [];
        // Remaining parts after the header are filenames
        for (let i = 5; i < headerParts.length; i++) {
          if (headerParts[i].trim()) fileBuffer.push(headerParts[i].trim());
        }
      } else {
        // File names from --name-only
        for (const p of parts) {
          if (p.trim()) fileBuffer.push(p.trim());
        }
      }
    }

    // Flush last commit
    if (current?.sha) {
      commits.push({
        sha: current.sha!,
        shortSha: current.shortSha!,
        message: current.message!,
        date: current.date!,
        relativeDate: current.relativeDate!,
        filesChanged: fileBuffer.filter(f => f.startsWith(folder + '/')),
      });
    }

    return commits;
  } catch {
    return [];
  }
}

/** Restore an intent folder to a specific commit's state. */
export async function restoreIntentVersion(workspaceRoot: string, folder: string, sha: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate sha looks legit
    if (!/^[0-9a-f]{7,40}$/.test(sha)) {
      return { success: false, error: 'Invalid commit SHA' };
    }

    // Checkout the folder contents from that commit
    await runGit(workspaceRoot, ['checkout', sha, '--', `${folder}/`]);

    // Auto-commit the restoration
    await runGit(workspaceRoot, ['add', '-A']);
    try {
      await runGit(workspaceRoot, ['diff', '--cached', '--quiet']);
      // No changes — already at this version
      return { success: true };
    } catch {
      // Has changes — commit the restore
    }

    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    await runGit(workspaceRoot, ['commit', '-m', `intent: restore to ${sha.slice(0, 7)} (${timestamp})`, '--no-verify']);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Restore failed' };
  }
}

// ── Attachment handling ─────────────────────────────────

/** Sanitize a filename for safe filesystem use. */
function sanitizeFilename(name: string): string {
  // Remove path separators and null bytes
  let safe = name.replace(/[/\\:\0]/g, '_');
  // Remove leading dots (hidden files)
  safe = safe.replace(/^\.+/, '');
  // Guard against Windows reserved names
  const baseName = safe.split('.')[0].toLowerCase();
  if (RESERVED_NAMES.has(baseName)) {
    safe = '_' + safe;
  }
  // Truncate to reasonable length
  if (safe.length > 200) {
    const ext = path.extname(safe);
    safe = safe.substring(0, 200 - ext.length) + ext;
  }
  return safe || 'attachment';
}

/** Deduplicate a filename by adding a numeric suffix. */
function deduplicateFilename(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let n = 1;
  while (fs.existsSync(path.join(dir, `${base} (${n})${ext}`))) n++;
  return `${base} (${n})${ext}`;
}

export interface SaveAttachmentResult {
  success: boolean;
  relativePath?: string;
  filename?: string;
  error?: string;
}

/** Save a pasted file into the intent's attachments folder. */
export function saveAttachment(
  workspaceRoot: string,
  folder: string,
  filename: string,
  data: Buffer
): SaveAttachmentResult {
  if (data.length > MAX_ATTACHMENT_SIZE) {
    return { success: false, error: `File too large (max ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB)` };
  }

  const sanitized = sanitizeFilename(filename);
  const attachDir = path.join(workspaceRoot, folder, ATTACHMENTS_DIR);

  if (!fs.existsSync(attachDir)) {
    fs.mkdirSync(attachDir, { recursive: true });
  }

  const finalName = deduplicateFilename(attachDir, sanitized);
  const filePath = path.join(attachDir, finalName);

  // Verify resolved path is within the intent folder
  const resolved = path.resolve(filePath);
  const folderRoot = path.resolve(path.join(workspaceRoot, folder));
  if (!resolved.startsWith(folderRoot)) {
    return { success: false, error: 'Invalid file path' };
  }

  fs.writeFileSync(filePath, data);
  return {
    success: true,
    relativePath: `${ATTACHMENTS_DIR}/${finalName}`,
    filename: finalName,
  };
}

/** Resolve an attachment path to an absolute path (with security check). */
export function resolveAttachmentPath(
  workspaceRoot: string,
  folder: string,
  relativePath: string
): string | null {
  const resolved = path.resolve(path.join(workspaceRoot, folder, relativePath));
  const folderRoot = path.resolve(path.join(workspaceRoot, folder));
  if (!resolved.startsWith(folderRoot)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

/** Get MIME type from file extension. */
export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    // Images
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    // Audio
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
    '.webm': 'audio/webm',
    // Video
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska', '.webm_v': 'video/webm',
    // Documents
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
    '.json': 'application/json', '.csv': 'text/csv',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Code
    '.js': 'application/javascript', '.ts': 'text/typescript',
    '.html': 'text/html', '.css': 'text/css',
    '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
  };
  // Special handling for .webm (could be audio or video)
  if (ext === '.webm') return 'video/webm';
  return mimeMap[ext] || 'application/octet-stream';
}
