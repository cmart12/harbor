import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/electron-path' },
}));

vi.mock('./workspace', () => ({
  readCanvas: vi.fn(() => ''),
  slugify: vi.fn((text: string, spaceId: string) => {
    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'space';
    return `${slug}-${spaceId.replace(/-/g, '').slice(0, 4)}`;
  }),
}));

import {
  initDatabase,
  closeDatabase,
  createSpace,
  listSpaces,
  updateSpace,
} from './database';
import {
  fingerprintPathFor,
  readFingerprint,
  SCHEMA_VERSION,
} from './db-fingerprint';
import { listLogFiles } from './log-store';

let testDir: string;
let dbPath: string;
let logRoot: string;

function fresh() {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-fingerprint-int-'));
  dbPath = path.join(testDir, 'spaces.db');
  logRoot = path.join(testDir, 'events');
}

beforeEach(() => {
  vi.clearAllMocks();
  fresh();
});

afterEach(() => {
  closeDatabase();
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('initDatabase fingerprint fast path', () => {
  it('writes a sidecar after a fresh build', () => {
    initDatabase(dbPath, logRoot);
    createSpace({ body: 'Hello' });
    closeDatabase();

    initDatabase(dbPath, logRoot);
    closeDatabase();

    const sidecar = fingerprintPathFor(dbPath);
    expect(fs.existsSync(sidecar)).toBe(true);
    const fp = readFingerprint(sidecar);
    expect(fp).not.toBeNull();
    expect(fp!.schemaVersion).toBe(SCHEMA_VERSION);
    expect(fp!.db?.path).toBe(dbPath);
    expect(fp!.logFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('reuses the cached DB when the log + DB are unchanged', async () => {
    // Seed: create one space, then close.
    initDatabase(dbPath, logRoot);
    const space = createSpace({ body: 'Persistent' });
    closeDatabase();

    // Spy on replayLog to prove the fast path skipped it.
    const eventlog = await import('./eventlog');
    const replaySpy = vi.spyOn(eventlog, 'replayLog');

    initDatabase(dbPath, logRoot);
    const spaces = listSpaces();
    expect(spaces.find((s) => s.id === space.id)).toBeDefined();
    expect(replaySpy).not.toHaveBeenCalled();

    replaySpy.mockRestore();
    closeDatabase();
  });

  it('falls back to rebuild when the log changes between sessions', () => {
    initDatabase(dbPath, logRoot);
    createSpace({ body: 'First' });
    closeDatabase();

    // Simulate another process / window appending to the log while the DB
    // is closed — e.g., a sibling client that synced new events via git.
    initDatabase(dbPath, logRoot);
    createSpace({ body: 'Second' });
    closeDatabase();

    // Tamper with the sidecar's recorded DB stats to force a mismatch.
    // (Realistically the previous close already updated the sidecar to
    // match, so we synthesise a mismatch by appending more events
    // without invoking initDatabase again, then check the next init.)
    const sidecar = fingerprintPathFor(dbPath);
    const fpBefore = readFingerprint(sidecar)!;
    const segments = listLogFiles(logRoot);
    expect(segments.length).toBeGreaterThan(0);
    // Append a raw event to the last segment to simulate an out-of-band write.
    const lastSegment = segments[segments.length - 1];
    fs.appendFileSync(lastSegment,
      JSON.stringify({
        ts: '2099-01-01T00:00:00.000Z',
        op: 'space.create',
        data: {
          id: 'third-id',
          description: 'Third (out of band)',
          body: 'Third',
          status: 'captured',
          attachments: '[]',
          folder: 'third-folder',
          created_at: '2099-01-01T00:00:00.000Z',
          updated_at: '2099-01-01T00:00:00.000Z',
        },
      }) + '\n',
    );

    initDatabase(dbPath, logRoot);
    // The replay must have picked up the appended event.
    expect(listSpaces().some((s) => s.id === 'third-id')).toBe(true);

    // A fresh sidecar should reflect the new state.
    const fpAfter = readFingerprint(sidecar)!;
    expect(fpAfter.logFiles[0].sha256).not.toBe(fpBefore.logFiles[0].sha256);
    closeDatabase();
  });

  it('falls back to rebuild when the DB file is replaced externally', () => {
    initDatabase(dbPath, logRoot);
    const space = createSpace({ body: 'Original' });
    closeDatabase();

    // Replace the DB file with garbage to simulate corruption / tampering.
    fs.writeFileSync(dbPath, 'not a real db');

    // initDatabase should notice the DB file changed → replay the log
    // and write a fresh, queryable cache.
    initDatabase(dbPath, logRoot);
    const spaces = listSpaces();
    expect(spaces.find((s) => s.id === space.id)).toBeDefined();
    closeDatabase();
  });

  it('falls back to rebuild when the sidecar is missing', () => {
    initDatabase(dbPath, logRoot);
    const space = createSpace({ body: 'A space' });
    closeDatabase();

    fs.unlinkSync(fingerprintPathFor(dbPath));

    initDatabase(dbPath, logRoot);
    expect(listSpaces().find((s) => s.id === space.id)).toBeDefined();
    closeDatabase();
  });

  it('persists updates through the fast path round-trip', () => {
    initDatabase(dbPath, logRoot);
    const space = createSpace({ body: 'V1' });
    updateSpace(space.id, { description: 'V2' });
    closeDatabase();

    initDatabase(dbPath, logRoot);
    const reloaded = listSpaces().find((s) => s.id === space.id)!;
    expect(reloaded.description).toBe('V2');
    closeDatabase();
  });
});
