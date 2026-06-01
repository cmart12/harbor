import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  INLINE_THRESHOLD,
  initContentStore,
  closeContentStore,
  getContentDir,
  makeDigest,
  storeContent,
  readContent,
  deleteContent,
  resolveContent,
} from './subagent-content-store';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-content-test-'));
  initContentStore(path.join(tmpDir, 'subagent-content'));
});

afterEach(() => {
  closeContentStore();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('initContentStore', () => {
  it('creates the directory if it does not exist', () => {
    expect(fs.existsSync(path.join(tmpDir, 'subagent-content'))).toBe(true);
  });

  it('is idempotent across repeat calls', () => {
    expect(() => initContentStore(path.join(tmpDir, 'subagent-content'))).not.toThrow();
    expect(getContentDir()).toBe(path.join(tmpDir, 'subagent-content'));
  });
});

describe('closeContentStore', () => {
  it('clears the active dir', () => {
    closeContentStore();
    expect(getContentDir()).toBeNull();
  });
});

describe('makeDigest', () => {
  it('captures length, sha256, head, and tail', () => {
    const text = 'hello world';
    const d = makeDigest(text);
    expect(d.length).toBe(text.length);
    expect(d.sha256).toBe(crypto.createHash('sha256').update(text, 'utf8').digest('hex'));
    expect(d.head).toBe('hello world');
    expect(d.tail).toBe('');
  });

  it('truncates head to 256 chars and includes a tail for long content', () => {
    const text = 'a'.repeat(1000);
    const d = makeDigest(text);
    expect(d.length).toBe(1000);
    expect(d.head.length).toBe(256);
    expect(d.tail.length).toBe(256);
  });
});

describe('storeContent', () => {
  it('keeps small content inline and does not write a file', () => {
    const ref = storeContent('agent-1.streaming.txt', 'small payload');
    expect(ref.inline).toBe('small payload');
    expect(ref.path).toBeUndefined();
    expect(fs.readdirSync(getContentDir()!)).toEqual([]);
  });

  it('off-loads content above the threshold to a side file', () => {
    const big = 'x'.repeat(INLINE_THRESHOLD + 100);
    const ref = storeContent('agent-1.streaming.txt', big);
    expect(ref.path).toBe('agent-1.streaming.txt');
    expect(ref.inline).toBeUndefined();
    const disk = fs.readFileSync(path.join(getContentDir()!, ref.path!), 'utf8');
    expect(disk).toBe(big);
  });

  it('always returns a digest matching the input', () => {
    const text = 'y'.repeat(INLINE_THRESHOLD + 1);
    const ref = storeContent('a.txt', text);
    expect(ref.digest.length).toBe(text.length);
    expect(ref.digest.sha256).toBe(crypto.createHash('sha256').update(text, 'utf8').digest('hex'));
  });

  it('sanitises unsafe characters in the key', () => {
    const big = 'z'.repeat(INLINE_THRESHOLD + 1);
    const ref = storeContent('weird/key:with*chars', big);
    expect(ref.path).toBe('weird_key_with_chars');
    expect(fs.existsSync(path.join(getContentDir()!, ref.path!))).toBe(true);
  });

  it('falls back to inline when the store is uninitialised', () => {
    closeContentStore();
    const big = 'q'.repeat(INLINE_THRESHOLD + 1);
    const ref = storeContent('a.txt', big);
    expect(ref.inline).toBe(big);
    expect(ref.path).toBeUndefined();
  });

  it('atomic write: side file appears in full or not at all', () => {
    const big = 'm'.repeat(INLINE_THRESHOLD + 200);
    const ref = storeContent('atomic.txt', big);
    expect(ref.path).toBe('atomic.txt');
    const disk = fs.readFileSync(path.join(getContentDir()!, ref.path!), 'utf8');
    expect(disk).toBe(big);
    // No stray .tmp files left behind.
    const leftover = fs.readdirSync(getContentDir()!).filter(f => f.includes('.tmp-'));
    expect(leftover).toEqual([]);
  });
});

describe('readContent', () => {
  it('returns the content for an existing path', () => {
    const big = 'k'.repeat(INLINE_THRESHOLD + 1);
    const ref = storeContent('foo.txt', big);
    expect(readContent(ref.path!)).toBe(big);
  });

  it('returns null for a missing file', () => {
    expect(readContent('does-not-exist.txt')).toBeNull();
  });

  it('returns null when the store is uninitialised', () => {
    closeContentStore();
    expect(readContent('foo.txt')).toBeNull();
  });
});

describe('deleteContent', () => {
  it('removes the side file', () => {
    const big = 'h'.repeat(INLINE_THRESHOLD + 1);
    const ref = storeContent('to-delete.txt', big);
    expect(fs.existsSync(path.join(getContentDir()!, ref.path!))).toBe(true);
    deleteContent(ref.path!);
    expect(fs.existsSync(path.join(getContentDir()!, ref.path!))).toBe(false);
  });

  it('is a no-op for missing files', () => {
    expect(() => deleteContent('nope.txt')).not.toThrow();
  });
});

describe('resolveContent', () => {
  it('returns inline content when present', () => {
    expect(resolveContent({ inline: 'abc' })).toBe('abc');
  });

  it('reads the side file when only path is set', () => {
    const big = 'r'.repeat(INLINE_THRESHOLD + 1);
    const ref = storeContent('resolved.txt', big);
    expect(resolveContent({ path: ref.path! })).toBe(big);
  });

  it('returns empty string when neither inline nor path is set', () => {
    expect(resolveContent({})).toBe('');
  });

  it('returns empty string when path points to a missing file', () => {
    expect(resolveContent({ path: 'gone.txt' })).toBe('');
  });

  it('falls back to inline when the side file is missing', () => {
    expect(resolveContent({ inline: 'fallback', path: 'gone.txt' })).toBe('fallback');
  });

  it('prefers the side file when both are provided (off-load semantics)', () => {
    const big = 's'.repeat(INLINE_THRESHOLD + 1);
    const ref = storeContent('both.txt', big);
    expect(resolveContent({ inline: '', path: ref.path! })).toBe(big);
  });
});

describe('round-trip via storeContent + resolveContent', () => {
  it('recovers exact bytes for varied payload sizes', () => {
    const cases = [
      '',
      'hi',
      'x'.repeat(INLINE_THRESHOLD),
      'x'.repeat(INLINE_THRESHOLD + 1),
      'x'.repeat(INLINE_THRESHOLD * 4),
    ];
    for (const text of cases) {
      const ref = storeContent(`size-${text.length}.txt`, text);
      expect(resolveContent(ref)).toBe(text);
    }
  });
});
