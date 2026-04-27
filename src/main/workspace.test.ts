import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Mock electron before importing workspace
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

import {
  slugify,
  createIntentFolder,
  initWorkspace,
  readCanvas,
  writeCanvas,
  getCanvasPath,
  initIntentCanvas,
  saveAttachment,
  resolveAttachmentPath,
  getMimeType,
  getIntentDir,
  getLogPath,
  getDbPath,
  archiveIntentFolder,
  deleteIntentFolder,
} from './workspace';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Path helpers ────────────────────────────────────────

describe('getIntentDir', () => {
  it('returns .intent dir inside workspace root', () => {
    expect(getIntentDir('/workspace')).toBe(path.join('/workspace', '.intent'));
  });
});

describe('getLogPath', () => {
  it('returns events.jsonl inside .intent', () => {
    expect(getLogPath('/workspace')).toBe(path.join('/workspace', '.intent', 'events.jsonl'));
  });
});

describe('getDbPath', () => {
  it('returns intents.db inside .intent', () => {
    expect(getDbPath('/workspace')).toBe(path.join('/workspace', '.intent', 'intents.db'));
  });
});

// ── slugify ─────────────────────────────────────────────

describe('slugify', () => {
  const id = 'abcd-1234-ef56';

  it('lowercases and hyphenates normal text', () => {
    const result = slugify('Hello World', id);
    expect(result).toBe('hello-world-abcd');
  });

  it('truncates text longer than 60 chars', () => {
    const long = 'a'.repeat(80);
    const result = slugify(long, id);
    // 60 chars of slug + '-' + 4 char id suffix
    expect(result.length).toBeLessThanOrEqual(65);
    expect(result).toMatch(/^a{60}-abcd$/);
  });

  it('replaces special characters with hyphens and collapses them', () => {
    const result = slugify('hello!!!world@@@test', id);
    expect(result).toBe('hello-world-test-abcd');
  });

  it('trims leading and trailing hyphens', () => {
    const result = slugify('---hello---', id);
    expect(result).toBe('hello-abcd');
  });

  it('prefixes Windows reserved names with intent-', () => {
    for (const reserved of ['con', 'prn', 'aux', 'nul', 'com1', 'lpt1']) {
      const result = slugify(reserved, id);
      expect(result).toMatch(/^intent-/);
    }
  });

  it('prefixes reserved name even when followed by other segments', () => {
    const result = slugify('CON something', id);
    expect(result).toBe('intent-con-something-abcd');
  });

  it('returns just the id suffix for empty string', () => {
    const result = slugify('', id);
    expect(result).toBe('abcd');
  });

  it('returns just the id suffix for text with only special chars', () => {
    const result = slugify('!!!@@@###', id);
    expect(result).toBe('abcd');
  });

  it('strips hyphens from intentId to form suffix', () => {
    const result = slugify('test', 'aaaa-bbbb-cccc');
    expect(result).toBe('test-aaaa');
  });
});

// ── createIntentFolder ──────────────────────────────────

describe('createIntentFolder', () => {
  const id = 'abcd-1234';

  it('creates a directory in the workspace root', () => {
    const folder = createIntentFolder(tmpDir, id, 'My Task');
    expect(fs.existsSync(path.join(tmpDir, folder))).toBe(true);
  });

  it('returns the relative folder name (the slug)', () => {
    const folder = createIntentFolder(tmpDir, id, 'My Task');
    expect(folder).toBe('my-task-abcd');
    expect(path.isAbsolute(folder)).toBe(false);
  });

  it('does not fail if folder already exists', () => {
    const folder = createIntentFolder(tmpDir, id, 'My Task');
    expect(() => createIntentFolder(tmpDir, id, 'My Task')).not.toThrow();
    expect(fs.existsSync(path.join(tmpDir, folder))).toBe(true);
  });
});

// ── initWorkspace ───────────────────────────────────────

describe('initWorkspace', () => {
  it('creates .intent/ directory', () => {
    initWorkspace(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, '.intent'))).toBe(true);
  });

  it('creates .gitignore with required entries when none exists', () => {
    initWorkspace(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('.intent/*.db');
    expect(content).toContain('.intent/*.db-journal');
    expect(content).toContain('.intent/*.db-wal');
    expect(content).toContain('.intent/*.db-shm');
    expect(content).toContain('*/attachments/');
    expect(content).toContain('*/.workspace/');
  });

  it('appends missing entries to existing .gitignore', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '# existing\nnode_modules/\n.intent/*.db\n');
    initWorkspace(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    // Existing entry should not be duplicated
    expect(content.match(/\.intent\/\*\.db\n/g)?.length).toBe(1);
    // Missing entries should be added
    expect(content).toContain('.intent/*.db-journal');
    expect(content).toContain('*/attachments/');
  });

  it('is idempotent: does not duplicate entries on second call', () => {
    initWorkspace(tmpDir);
    initWorkspace(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    expect(content.match(/\.intent\/\*\.db\n/g)?.length).toBe(1);
    expect(content.match(/\*\/attachments\//g)?.length).toBe(1);
  });
});

// ── readCanvas / writeCanvas ────────────────────────────

describe('readCanvas / writeCanvas', () => {
  const folder = 'test-folder';

  it('round-trips content correctly', () => {
    writeCanvas(tmpDir, folder, '# Hello\n\nSome **markdown**');
    const content = readCanvas(tmpDir, folder);
    expect(content).toBe('# Hello\n\nSome **markdown**');
  });

  it('returns empty string for missing canvas', () => {
    expect(readCanvas(tmpDir, 'nonexistent')).toBe('');
  });

  it('creates folder if needed on write', () => {
    const deepFolder = 'deep/nested/folder';
    writeCanvas(tmpDir, deepFolder, 'content');
    expect(fs.existsSync(path.join(tmpDir, deepFolder, 'canvas.md'))).toBe(true);
  });
});

// ── initIntentCanvas ────────────────────────────────────

describe('initIntentCanvas', () => {
  const id = 'abcd-1234';

  it('seeds canvas with body content', () => {
    const folder = initIntentCanvas(tmpDir, id, 'My Task', 'Initial body text');
    const content = readCanvas(tmpDir, folder);
    expect(content).toBe('Initial body text\n');
  });

  it('does not overwrite existing canvas file', () => {
    const folder = initIntentCanvas(tmpDir, id, 'My Task', 'First body');
    initIntentCanvas(tmpDir, id, 'My Task', 'Second body');
    const content = readCanvas(tmpDir, folder);
    expect(content).toBe('First body\n');
  });

  it('handles null body gracefully', () => {
    const folder = initIntentCanvas(tmpDir, id, 'My Task', null);
    const content = readCanvas(tmpDir, folder);
    expect(content).toBe('');
  });

  it('handles empty string body gracefully', () => {
    const folder = initIntentCanvas(tmpDir, id, 'My Task', '');
    const content = readCanvas(tmpDir, folder);
    expect(content).toBe('');
  });

  it('handles whitespace-only body gracefully', () => {
    const folder = initIntentCanvas(tmpDir, id, 'My Task', '   \n  ');
    const content = readCanvas(tmpDir, folder);
    expect(content).toBe('');
  });
});

// ── saveAttachment ──────────────────────────────────────

describe('saveAttachment', () => {
  const folder = 'test-intent';

  beforeEach(() => {
    fs.mkdirSync(path.join(tmpDir, folder), { recursive: true });
  });

  it('saves file to attachments directory', () => {
    const data = Buffer.from('hello world');
    const result = saveAttachment(tmpDir, folder, 'test.txt', data);
    expect(result.success).toBe(true);
    expect(result.filename).toBe('test.txt');
    expect(result.relativePath).toBe('attachments/test.txt');
    const saved = fs.readFileSync(path.join(tmpDir, folder, 'attachments', 'test.txt'));
    expect(saved.toString()).toBe('hello world');
  });

  it('rejects files over 25MB', () => {
    const bigData = Buffer.alloc(25 * 1024 * 1024 + 1);
    const result = saveAttachment(tmpDir, folder, 'big.bin', bigData);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });

  it('sanitizes filename: strips path separators', () => {
    const data = Buffer.from('x');
    const result = saveAttachment(tmpDir, folder, 'some/path\\file.txt', data);
    expect(result.success).toBe(true);
    expect(result.filename).not.toMatch(/[/\\]/);
  });

  it('sanitizes filename: removes leading dots', () => {
    const data = Buffer.from('x');
    const result = saveAttachment(tmpDir, folder, '..hidden.txt', data);
    expect(result.success).toBe(true);
    expect(result.filename).not.toMatch(/^\./);
  });

  it('sanitizes filename: guards Windows reserved names', () => {
    const data = Buffer.from('x');
    const result = saveAttachment(tmpDir, folder, 'CON.txt', data);
    expect(result.success).toBe(true);
    expect(result.filename).toBe('_CON.txt');
  });

  it('sanitizes filename: truncates long names to 200 chars', () => {
    const longName = 'a'.repeat(250) + '.txt';
    const data = Buffer.from('x');
    const result = saveAttachment(tmpDir, folder, longName, data);
    expect(result.success).toBe(true);
    expect(result.filename!.length).toBeLessThanOrEqual(200);
    expect(result.filename).toMatch(/\.txt$/);
  });

  it('deduplicates filenames with numeric suffix', () => {
    const data = Buffer.from('x');
    saveAttachment(tmpDir, folder, 'dup.txt', data);
    const result2 = saveAttachment(tmpDir, folder, 'dup.txt', data);
    expect(result2.success).toBe(true);
    expect(result2.filename).toBe('dup (1).txt');
    const result3 = saveAttachment(tmpDir, folder, 'dup.txt', data);
    expect(result3.filename).toBe('dup (2).txt');
  });

  it('prevents path traversal', () => {
    const data = Buffer.from('x');
    const result = saveAttachment(tmpDir, folder, '../../etc/passwd', data);
    expect(result.success).toBe(true);
    // File should end up inside the intent folder, not outside
    const filePath = path.join(tmpDir, folder, 'attachments', result.filename!);
    const resolved = path.resolve(filePath);
    expect(resolved.startsWith(path.resolve(path.join(tmpDir, folder)))).toBe(true);
  });
});

// ── resolveAttachmentPath ───────────────────────────────

describe('resolveAttachmentPath', () => {
  const folder = 'test-intent';

  beforeEach(() => {
    const attachDir = path.join(tmpDir, folder, 'attachments');
    fs.mkdirSync(attachDir, { recursive: true });
    fs.writeFileSync(path.join(attachDir, 'valid.txt'), 'data');
  });

  it('returns absolute path for valid attachment', () => {
    const result = resolveAttachmentPath(tmpDir, folder, 'attachments/valid.txt');
    expect(result).toBe(path.resolve(path.join(tmpDir, folder, 'attachments', 'valid.txt')));
  });

  it('returns null for path traversal attempts', () => {
    const result = resolveAttachmentPath(tmpDir, folder, '../../etc/passwd');
    expect(result).toBeNull();
  });

  it('returns null for missing files', () => {
    const result = resolveAttachmentPath(tmpDir, folder, 'attachments/nonexistent.txt');
    expect(result).toBeNull();
  });
});

// ── getMimeType ─────────────────────────────────────────

describe('getMimeType', () => {
  it('returns correct type for common image extensions', () => {
    expect(getMimeType('photo.png')).toBe('image/png');
    expect(getMimeType('photo.jpg')).toBe('image/jpeg');
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(getMimeType('photo.gif')).toBe('image/gif');
    expect(getMimeType('photo.webp')).toBe('image/webp');
    expect(getMimeType('icon.svg')).toBe('image/svg+xml');
  });

  it('returns correct type for document extensions', () => {
    expect(getMimeType('file.pdf')).toBe('application/pdf');
    expect(getMimeType('file.txt')).toBe('text/plain');
    expect(getMimeType('file.md')).toBe('text/markdown');
    expect(getMimeType('file.json')).toBe('application/json');
    expect(getMimeType('file.csv')).toBe('text/csv');
  });

  it('returns correct type for video extensions', () => {
    expect(getMimeType('video.mp4')).toBe('video/mp4');
    expect(getMimeType('video.mov')).toBe('video/quicktime');
  });

  it('returns correct type for audio extensions', () => {
    expect(getMimeType('audio.mp3')).toBe('audio/mpeg');
    expect(getMimeType('audio.wav')).toBe('audio/wav');
  });

  it('returns application/octet-stream for unknown extensions', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream');
    expect(getMimeType('file.blah')).toBe('application/octet-stream');
  });

  it('handles .webm as video/webm (special case override)', () => {
    // The code has a special override that returns video/webm for .webm
    expect(getMimeType('file.webm')).toBe('video/webm');
  });

  it('is case-insensitive via lowering the extension', () => {
    expect(getMimeType('photo.PNG')).toBe('image/png');
    expect(getMimeType('file.PDF')).toBe('application/pdf');
  });
});

// ── archiveIntentFolder ─────────────────────────────────

describe('archiveIntentFolder', () => {
  const folder = 'my-task-abcd';

  it('moves folder into .intent/archive/', () => {
    const src = path.join(tmpDir, folder);
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'canvas.md'), 'hello');

    archiveIntentFolder(tmpDir, folder);

    expect(fs.existsSync(src)).toBe(false);
    const archived = path.join(tmpDir, '.intent', 'archive', folder, 'canvas.md');
    expect(fs.existsSync(archived)).toBe(true);
    expect(fs.readFileSync(archived, 'utf-8')).toBe('hello');
  });

  it('creates .intent/archive/ directory if it does not exist', () => {
    const src = path.join(tmpDir, folder);
    fs.mkdirSync(src, { recursive: true });

    archiveIntentFolder(tmpDir, folder);

    expect(fs.existsSync(path.join(tmpDir, '.intent', 'archive'))).toBe(true);
  });

  it('replaces existing archive if re-completing', () => {
    const src = path.join(tmpDir, folder);
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'canvas.md'), 'v1');
    archiveIntentFolder(tmpDir, folder);

    // Re-create and re-archive with new content
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'canvas.md'), 'v2');
    archiveIntentFolder(tmpDir, folder);

    const archived = path.join(tmpDir, '.intent', 'archive', folder, 'canvas.md');
    expect(fs.readFileSync(archived, 'utf-8')).toBe('v2');
  });

  it('does nothing when source folder does not exist', () => {
    expect(() => archiveIntentFolder(tmpDir, 'nonexistent')).not.toThrow();
  });

  it('does nothing when folder is empty string', () => {
    expect(() => archiveIntentFolder(tmpDir, '')).not.toThrow();
  });
});

// ── deleteIntentFolder ──────────────────────────────────

describe('deleteIntentFolder', () => {
  const folder = 'my-task-abcd';

  it('removes the live folder from workspace root', () => {
    const src = path.join(tmpDir, folder);
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'canvas.md'), 'data');

    deleteIntentFolder(tmpDir, folder);

    expect(fs.existsSync(src)).toBe(false);
  });

  it('removes the archived folder too', () => {
    const archivePath = path.join(tmpDir, '.intent', 'archive', folder);
    fs.mkdirSync(archivePath, { recursive: true });
    fs.writeFileSync(path.join(archivePath, 'canvas.md'), 'data');

    deleteIntentFolder(tmpDir, folder);

    expect(fs.existsSync(archivePath)).toBe(false);
  });

  it('removes both live and archived folders', () => {
    const livePath = path.join(tmpDir, folder);
    fs.mkdirSync(livePath, { recursive: true });
    fs.writeFileSync(path.join(livePath, 'canvas.md'), 'live');

    const archivePath = path.join(tmpDir, '.intent', 'archive', folder);
    fs.mkdirSync(archivePath, { recursive: true });
    fs.writeFileSync(path.join(archivePath, 'canvas.md'), 'archived');

    deleteIntentFolder(tmpDir, folder);

    expect(fs.existsSync(livePath)).toBe(false);
    expect(fs.existsSync(archivePath)).toBe(false);
  });

  it('does nothing when neither folder exists', () => {
    expect(() => deleteIntentFolder(tmpDir, 'nonexistent')).not.toThrow();
  });

  it('does nothing when folder is empty string', () => {
    expect(() => deleteIntentFolder(tmpDir, '')).not.toThrow();
  });
});
