/**
 * Blake3 day-bucketed content hash for dedupe (Phase C.1).
 *
 * WorkIQ items (emails, Teams messages) lack a stable per-message ID in
 * every response. We hash a composite key that includes the day portion
 * of the timestamp so that re-ingesting the same message on the same day
 * yields the same `source_uid`, while a genuine resend on a later date
 * (rare but possible) is treated as distinct.
 *
 * Ported from Funnel's `workiq_source.rs::content_uid`.
 */

import { hash } from 'blake3';

/**
 * Produce a hex-encoded blake3 hash from a composite key.
 * @param parts  Ordered list of strings to include in the hash input.
 *               Null/undefined parts are replaced with an empty string.
 *               Parts are joined with `|` as delimiter.
 */
export function contentHash(...parts: Array<string | null | undefined>): string {
  const input = parts.map(p => p ?? '').join('|');
  return hash(Buffer.from(input, 'utf8')).toString('hex');
}

/**
 * Extract the date portion (YYYY-MM-DD) from an ISO-8601 timestamp.
 * Falls back to today's date if the input is malformed.
 */
export function dayBucket(isoTimestamp: string): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(isoTimestamp);
  return match ? match[0] : new Date().toISOString().slice(0, 10);
}
