import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  SCHEMA_VERSION,
  FINGERPRINT_FILENAME,
  fingerprintPathFor,
  readFingerprint,
  writeFingerprint,
  computeFingerprint,
  canSkipReplay,
  type Fingerprint,
} from './db-fingerprint';
import { appendEvent } from './eventlog';

let tmpDir: string;
let dbPath: string;
let logRoot: string;
let sidecar: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-fingerprint-test-'));
  dbPath = path.join(tmpDir, 'spaces.db');
  logRoot = path.join(tmpDir, 'events');
  sidecar = fingerprintPathFor(dbPath);
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('fingerprintPathFor', () => {
  it('places the sidecar alongside the DB file', () => {
    expect(fingerprintPathFor('/foo/.whim/spaces.db')).toBe(
      path.join('/foo/.whim', FINGERPRINT_FILENAME),
    );
  });
});

describe('read/writeFingerprint', () => {
  it('round-trips a fingerprint via JSON', () => {
    const fp: Fingerprint = {
      schemaVersion: SCHEMA_VERSION,
      createdAt: '2026-05-31T00:00:00.000Z',
      logFiles: [{ path: '/x', size: 10, mtimeMs: 1, sha256: 'abc' }],
      db: { path: '/db', size: 100, mtimeMs: 2 },
    };
    writeFingerprint(sidecar, fp);
    expect(readFingerprint(sidecar)).toEqual(fp);
  });

  it('returns null when the sidecar is missing', () => {
    expect(readFingerprint(sidecar)).toBeNull();
  });

  it('returns null when the sidecar is unparseable JSON', () => {
    fs.writeFileSync(sidecar, 'not json');
    expect(readFingerprint(sidecar)).toBeNull();
  });

  it('returns null when the sidecar is missing required fields', () => {
    fs.writeFileSync(sidecar, JSON.stringify({ logFiles: [] }));
    expect(readFingerprint(sidecar)).toBeNull();
  });

  it('uses atomic temp+rename so a missing sidecar leaves no orphan tmp', () => {
    writeFingerprint(sidecar, {
      schemaVersion: SCHEMA_VERSION,
      createdAt: 'x',
      logFiles: [],
    });
    expect(fs.existsSync(sidecar)).toBe(true);
    const stray = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp-'));
    expect(stray).toEqual([]);
  });
});

describe('computeFingerprint', () => {
  it('returns the current schema version and a stable created_at format', () => {
    const fp = computeFingerprint(logRoot, dbPath);
    expect(fp.schemaVersion).toBe(SCHEMA_VERSION);
    expect(new Date(fp.createdAt).toISOString()).toBe(fp.createdAt);
  });

  it('records every log file with size+mtime+sha', () => {
    appendEvent(logRoot, 'space.create', { id: 'a' });
    appendEvent(logRoot, 'space.create', { id: 'b' });
    const fp = computeFingerprint(logRoot, dbPath);
    expect(fp.logFiles.length).toBeGreaterThanOrEqual(1);
    for (const entry of fp.logFiles) {
      expect(entry.size).toBeGreaterThan(0);
      expect(entry.mtimeMs).toBeGreaterThan(0);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('records the DB file stat when it exists', () => {
    fs.writeFileSync(dbPath, 'pretend-sqlite');
    const fp = computeFingerprint(logRoot, dbPath);
    expect(fp.db?.path).toBe(dbPath);
    expect(fp.db?.size).toBe('pretend-sqlite'.length);
  });

  it('omits the DB section when the file is missing', () => {
    const fp = computeFingerprint(logRoot, dbPath);
    expect(fp.db).toBeUndefined();
  });

  it('reuses previous sha256 when size+mtime match', () => {
    appendEvent(logRoot, 'space.create', { id: 'a' });
    const first = computeFingerprint(logRoot, dbPath);
    // Construct a previous fingerprint with a poisoned sha to prove reuse.
    const poisoned: Fingerprint = {
      ...first,
      logFiles: first.logFiles.map((e) => ({ ...e, sha256: 'poison' })),
    };
    const second = computeFingerprint(logRoot, dbPath, poisoned);
    for (const entry of second.logFiles) {
      expect(entry.sha256).toBe('poison');
    }
  });

  it('recomputes sha256 when a file changes size', () => {
    appendEvent(logRoot, 'space.create', { id: 'a' });
    const first = computeFingerprint(logRoot, dbPath);
    appendEvent(logRoot, 'space.create', { id: 'b' });
    const second = computeFingerprint(logRoot, dbPath, first);
    expect(second.logFiles[0].sha256).not.toBe(first.logFiles[0].sha256);
  });
});

describe('canSkipReplay', () => {
  function seed(): Fingerprint {
    appendEvent(logRoot, 'space.create', { id: 'a' });
    fs.writeFileSync(dbPath, 'db-bytes');
    return computeFingerprint(logRoot, dbPath);
  }

  it('returns false when there is no previous fingerprint', () => {
    const current = seed();
    expect(canSkipReplay(null, current)).toBe(false);
  });

  it('returns true when previous and current match (DB unchanged, log unchanged)', () => {
    const prev = seed();
    const current = computeFingerprint(logRoot, dbPath, prev);
    expect(canSkipReplay(prev, current)).toBe(true);
  });

  it('returns false when schema versions differ', () => {
    const prev = seed();
    const current = computeFingerprint(logRoot, dbPath, prev);
    expect(canSkipReplay({ ...prev, schemaVersion: SCHEMA_VERSION - 1 }, current)).toBe(false);
  });

  it('returns false when a new log file appears', () => {
    const prev = seed();
    // Force a new segment by writing into a different month bucket.
    fs.mkdirSync(path.join(logRoot, '2099-01'), { recursive: true });
    fs.writeFileSync(path.join(logRoot, '2099-01', 'events-001.jsonl'), '{"ts":"2099-01-01T00:00:00.000Z","op":"x","data":{}}\n');
    const current = computeFingerprint(logRoot, dbPath, prev);
    expect(canSkipReplay(prev, current)).toBe(false);
  });

  it('returns false when an existing log file size changes', () => {
    const prev = seed();
    appendEvent(logRoot, 'space.create', { id: 'b' });
    const current = computeFingerprint(logRoot, dbPath, prev);
    expect(canSkipReplay(prev, current)).toBe(false);
  });

  it('returns false when the DB file size changes', () => {
    const prev = seed();
    fs.writeFileSync(dbPath, 'totally-different-bytes');
    const current = computeFingerprint(logRoot, dbPath, prev);
    expect(canSkipReplay(prev, current)).toBe(false);
  });

  it('returns false when the DB file goes missing', () => {
    const prev = seed();
    fs.unlinkSync(dbPath);
    const current = computeFingerprint(logRoot, dbPath, prev);
    expect(canSkipReplay(prev, current)).toBe(false);
  });
});
