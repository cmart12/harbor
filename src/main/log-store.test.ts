import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  MAX_SEGMENT_BYTES,
  SNAPSHOT_FILENAME,
  LEGACY_LOG_FILENAME,
  segmentFilename,
  monthBucket,
  getLogRoot,
  resolveActiveSegment,
  listLogFiles,
  migrateLegacyEventLog,
} from './log-store';

let tmpDir: string;
let whimDir: string;
let logRoot: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-store-test-'));
  whimDir = path.join(tmpDir, '.whim');
  fs.mkdirSync(whimDir, { recursive: true });
  logRoot = getLogRoot(whimDir);
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('segmentFilename', () => {
  it('zero-pads to 3 digits', () => {
    expect(segmentFilename(1)).toBe('events-001.jsonl');
    expect(segmentFilename(42)).toBe('events-042.jsonl');
    expect(segmentFilename(999)).toBe('events-999.jsonl');
  });

  it('does not truncate numbers above 999', () => {
    expect(segmentFilename(1000)).toBe('events-1000.jsonl');
  });
});

describe('monthBucket', () => {
  it('formats as YYYY-MM using UTC', () => {
    expect(monthBucket(new Date(Date.UTC(2026, 4, 31, 23, 59)))).toBe('2026-05');
    expect(monthBucket(new Date(Date.UTC(2024, 0, 1, 0, 0)))).toBe('2024-01');
  });
});

describe('getLogRoot', () => {
  it('returns the events/ tree root under .whim/', () => {
    expect(getLogRoot('/foo/.whim')).toBe(path.join('/foo/.whim', 'events'));
  });
});

describe('resolveActiveSegment', () => {
  it('creates the bucket dir and returns events-001 when empty', () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    const target = resolveActiveSegment(logRoot, now);
    expect(target).toBe(path.join(logRoot, '2026-05', 'events-001.jsonl'));
    expect(fs.existsSync(path.dirname(target))).toBe(true);
  });

  it('keeps appending to the latest segment when under the size cap', () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    const target1 = resolveActiveSegment(logRoot, now);
    fs.writeFileSync(target1, 'x'.repeat(1024));
    const target2 = resolveActiveSegment(logRoot, now);
    expect(target2).toBe(target1);
  });

  it('rolls to the next segment once the latest reaches the cap', () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    const target1 = resolveActiveSegment(logRoot, now);
    fs.writeFileSync(target1, Buffer.alloc(MAX_SEGMENT_BYTES));
    const target2 = resolveActiveSegment(logRoot, now);
    expect(target2).toBe(path.join(logRoot, '2026-05', 'events-002.jsonl'));
  });

  it('continues numbering when many segments exist', () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    const bucket = path.join(logRoot, '2026-05');
    fs.mkdirSync(bucket, { recursive: true });
    for (const n of [1, 2, 3]) {
      fs.writeFileSync(path.join(bucket, segmentFilename(n)), Buffer.alloc(MAX_SEGMENT_BYTES));
    }
    const target = resolveActiveSegment(logRoot, now);
    expect(target).toBe(path.join(bucket, 'events-004.jsonl'));
  });

  it('picks a different bucket for a different month', () => {
    const may = resolveActiveSegment(logRoot, new Date(Date.UTC(2026, 4, 15)));
    const june = resolveActiveSegment(logRoot, new Date(Date.UTC(2026, 5, 1)));
    expect(path.dirname(may)).not.toBe(path.dirname(june));
    expect(june).toBe(path.join(logRoot, '2026-06', 'events-001.jsonl'));
  });
});

describe('listLogFiles', () => {
  it('returns empty when the tree does not exist', () => {
    expect(listLogFiles(logRoot)).toEqual([]);
  });

  it('returns snapshot first then buckets in lexical order', () => {
    fs.mkdirSync(logRoot, { recursive: true });
    fs.mkdirSync(path.join(logRoot, '2026-05'), { recursive: true });
    fs.mkdirSync(path.join(logRoot, '2026-04'), { recursive: true });
    fs.writeFileSync(path.join(logRoot, SNAPSHOT_FILENAME), '');
    fs.writeFileSync(path.join(logRoot, '2026-04', 'events-001.jsonl'), '');
    fs.writeFileSync(path.join(logRoot, '2026-04', 'events-002.jsonl'), '');
    fs.writeFileSync(path.join(logRoot, '2026-05', 'events-001.jsonl'), '');

    const files = listLogFiles(logRoot);
    expect(files.map((f) => path.relative(logRoot, f).replace(/\\/g, '/'))).toEqual([
      SNAPSHOT_FILENAME,
      '2026-04/events-001.jsonl',
      '2026-04/events-002.jsonl',
      '2026-05/events-001.jsonl',
    ]);
  });

  it('orders segments numerically not lexically (10 after 9)', () => {
    fs.mkdirSync(path.join(logRoot, '2026-05'), { recursive: true });
    for (const n of [10, 1, 9, 2]) {
      fs.writeFileSync(path.join(logRoot, '2026-05', segmentFilename(n)), '');
    }
    const files = listLogFiles(logRoot);
    expect(files.map((f) => path.basename(f))).toEqual([
      'events-001.jsonl',
      'events-002.jsonl',
      'events-009.jsonl',
      'events-010.jsonl',
    ]);
  });

  it('ignores non-bucket and non-segment files', () => {
    fs.mkdirSync(path.join(logRoot, '2026-05'), { recursive: true });
    fs.mkdirSync(path.join(logRoot, 'not-a-bucket'), { recursive: true });
    fs.writeFileSync(path.join(logRoot, 'orphan.txt'), '');
    fs.writeFileSync(path.join(logRoot, '2026-05', 'events-001.jsonl'), '');
    fs.writeFileSync(path.join(logRoot, '2026-05', 'README.md'), '');
    const files = listLogFiles(logRoot);
    expect(files.map((f) => path.basename(f))).toEqual(['events-001.jsonl']);
  });
});

describe('migrateLegacyEventLog', () => {
  it('is a no-op when no legacy file exists', () => {
    expect(migrateLegacyEventLog(whimDir)).toBeNull();
    expect(fs.existsSync(logRoot)).toBe(false);
  });

  it('removes an empty legacy file without creating the tree', () => {
    fs.writeFileSync(path.join(whimDir, LEGACY_LOG_FILENAME), '');
    expect(migrateLegacyEventLog(whimDir)).toBeNull();
    expect(fs.existsSync(path.join(whimDir, LEGACY_LOG_FILENAME))).toBe(false);
  });

  it('moves a populated legacy file into the bucket of its first event', () => {
    const legacy = path.join(whimDir, LEGACY_LOG_FILENAME);
    const e1 = JSON.stringify({ ts: '2024-03-01T00:00:00.000Z', op: 'space.create', data: { id: 'a' } });
    const e2 = JSON.stringify({ ts: '2024-04-01T00:00:00.000Z', op: 'space.create', data: { id: 'b' } });
    fs.writeFileSync(legacy, `${e1}\n${e2}\n`);

    const moved = migrateLegacyEventLog(whimDir);
    expect(moved).toBe(path.join(logRoot, '2024-03', 'events-001.jsonl'));
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(moved!, 'utf8')).toBe(`${e1}\n${e2}\n`);
  });

  it('falls back to mtime month when the first line is unparseable', () => {
    const legacy = path.join(whimDir, LEGACY_LOG_FILENAME);
    fs.writeFileSync(legacy, '{not-json\nmore garbage\n');
    const mtimeMonth = monthBucket(new Date(fs.statSync(legacy).mtimeMs));
    const moved = migrateLegacyEventLog(whimDir);
    expect(moved).toBe(path.join(logRoot, mtimeMonth, 'events-001.jsonl'));
  });

  it('refuses to overwrite an existing segment-001 in the target bucket', () => {
    const legacy = path.join(whimDir, LEGACY_LOG_FILENAME);
    const e1 = JSON.stringify({ ts: '2024-03-01T00:00:00.000Z', op: 'x', data: {} });
    fs.writeFileSync(legacy, `${e1}\n`);

    // Pre-populate the target.
    fs.mkdirSync(path.join(logRoot, '2024-03'), { recursive: true });
    fs.writeFileSync(path.join(logRoot, '2024-03', 'events-001.jsonl'), 'pre-existing');

    const moved = migrateLegacyEventLog(whimDir);
    expect(moved).toBeNull();
    // Legacy file is left alone for the caller to handle.
    expect(fs.existsSync(legacy)).toBe(true);
    expect(fs.readFileSync(path.join(logRoot, '2024-03', 'events-001.jsonl'), 'utf8')).toBe('pre-existing');
  });
});
