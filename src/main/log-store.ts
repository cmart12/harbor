/**
 * LogStore — the on-disk layout for Whim's append-only event log.
 *
 * The legacy layout used a single growing file at `<workspace>/.whim/events.jsonl`.
 * This module replaces that with a rotated tree under `<workspace>/.whim/events/`:
 *
 *     events/
 *       snapshot.jsonl              # background-compacted state for events
 *                                   # older than the keep window (Phase 4)
 *       YYYY-MM/
 *         events-001.jsonl          # active hot logs, rotated at 25 MB
 *         events-002.jsonl
 *
 * Files inside a month bucket are numbered deterministically, so two
 * clients that roll over independently each create the same next segment
 * name and git can line-merge their appends cleanly. Replay reads files
 * in lexicographic order (which is chronological by construction) and
 * trusts the per-event `ts` to break ties.
 *
 * The 25 MB cap stays comfortably under the 50 MB guard in
 * `workspace.ts:doCommit` (so segments are never silently unstaged) and
 * leaves headroom for git merge conflicts to expand the file briefly.
 *
 * This module is pure-ish: it computes paths and enumerates files. It
 * deliberately does not own the actual write — that's `appendEvent`'s
 * job — so it stays trivial to unit-test.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Hard cap per active segment. Rotation happens when an append would exceed this. */
export const MAX_SEGMENT_BYTES = 25 * 1024 * 1024;

/** Snapshot file produced by Phase 4 compaction. Lives at the tree root. */
export const SNAPSHOT_FILENAME = 'snapshot.jsonl';

/** Legacy single-file event log; migrated into the tree on first launch under the new layout. */
export const LEGACY_LOG_FILENAME = 'events.jsonl';

/** Directory name relative to `.whim/`. */
export const LOG_ROOT_DIRNAME = 'events';

/** Build a workspace-relative segment filename (`events-001.jsonl`, …). */
export function segmentFilename(n: number): string {
  return `events-${String(n).padStart(3, '0')}.jsonl`;
}

/** Build the bucket directory name from a Date (`2026-05`). */
export function monthBucket(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Convenience: `<whim>/events/`. */
export function getLogRoot(whimDir: string): string {
  return path.join(whimDir, LOG_ROOT_DIRNAME);
}

/**
 * Pick the file to append the next event to. The result is guaranteed to
 * exist (the parent dirs are created if missing).
 *
 * Behaviour:
 *   • If the latest segment in the current month bucket is below
 *     MAX_SEGMENT_BYTES, append there.
 *   • Otherwise create the next-numbered segment in the same bucket.
 *   • If the bucket is empty (or missing), start at events-001.jsonl.
 */
export function resolveActiveSegment(logRoot: string, now: Date = new Date()): string {
  const bucket = path.join(logRoot, monthBucket(now));
  if (!fs.existsSync(bucket)) {
    fs.mkdirSync(bucket, { recursive: true });
  }

  const segments = listSegmentNumbers(bucket);
  if (segments.length === 0) {
    return path.join(bucket, segmentFilename(1));
  }
  const last = segments[segments.length - 1];
  const lastPath = path.join(bucket, segmentFilename(last));
  let size = 0;
  try {
    size = fs.statSync(lastPath).size;
  } catch {
    // Missing file but in the listing — race or external delete. Treat as 0.
  }
  if (size >= MAX_SEGMENT_BYTES) {
    return path.join(bucket, segmentFilename(last + 1));
  }
  return lastPath;
}

/**
 * List every log file under `logRoot` in chronological replay order:
 * snapshot first (if present), then month buckets in sorted order, with
 * segments inside each bucket in numeric order.
 *
 * Returns an empty array when the tree doesn't exist yet.
 */
export function listLogFiles(logRoot: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(logRoot)) return out;

  const snapshot = path.join(logRoot, SNAPSHOT_FILENAME);
  if (fs.existsSync(snapshot)) out.push(snapshot);

  const entries = fs.readdirSync(logRoot, { withFileTypes: true });
  const buckets = entries
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();

  for (const bucket of buckets) {
    const bucketDir = path.join(logRoot, bucket);
    for (const n of listSegmentNumbers(bucketDir)) {
      out.push(path.join(bucketDir, segmentFilename(n)));
    }
  }
  return out;
}

/**
 * One-shot migration: move a legacy `<whim>/events.jsonl` into the tree.
 * The legacy file becomes `events/<first-event-month>/events-001.jsonl`.
 *
 * Idempotent: no-op if the legacy file is missing or empty, or if a
 * segment-001 already exists in the target bucket (already migrated).
 *
 * Returns the new path when a move happened, otherwise null.
 */
export function migrateLegacyEventLog(whimDir: string): string | null {
  const legacyPath = path.join(whimDir, LEGACY_LOG_FILENAME);
  if (!fs.existsSync(legacyPath)) return null;

  const stat = fs.statSync(legacyPath);
  if (stat.size === 0) {
    // Empty legacy file: drop it silently to keep the tree clean.
    try { fs.unlinkSync(legacyPath); } catch { /* non-fatal */ }
    return null;
  }

  const firstMonth = readFirstEventMonth(legacyPath) ?? monthBucket(new Date(stat.mtimeMs));
  const logRoot = getLogRoot(whimDir);
  const bucketDir = path.join(logRoot, firstMonth);
  fs.mkdirSync(bucketDir, { recursive: true });

  const target = path.join(bucketDir, segmentFilename(1));
  if (fs.existsSync(target)) {
    // Already migrated (or another client got here first). Don't clobber.
    return null;
  }

  fs.renameSync(legacyPath, target);
  return target;
}

/**
 * Parse the first line of `legacyPath` and extract its `ts` month
 * (`YYYY-MM`). Returns null if the first line is missing or unparseable.
 */
function readFirstEventMonth(legacyPath: string): string | null {
  try {
    const fd = fs.openSync(legacyPath, 'r');
    try {
      const buf = Buffer.alloc(2048);
      const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
      const slice = buf.slice(0, bytes).toString('utf8');
      const newline = slice.indexOf('\n');
      const firstLine = newline >= 0 ? slice.slice(0, newline) : slice;
      const event = JSON.parse(firstLine);
      if (event && typeof event.ts === 'string') {
        return event.ts.slice(0, 7); // 'YYYY-MM'
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Corrupt or unreadable — fall back to mtime.
  }
  return null;
}

/** Enumerate `events-NNN.jsonl` numbers in a bucket in ascending order. */
function listSegmentNumbers(bucketDir: string): number[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(bucketDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nums: number[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const m = /^events-(\d+)\.jsonl$/.exec(e.name);
    if (m) nums.push(parseInt(m[1], 10));
  }
  nums.sort((a, b) => a - b);
  return nums;
}
