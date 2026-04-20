import * as path from 'path';
import * as fs from 'fs';

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
