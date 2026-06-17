/**
 * Phase C.0: Deterministic per-source thread-id computation.
 *
 * Each rule is a pure function that returns a stable string key for
 * grouping notifications in the Feed. Thread IDs are computed at
 * ingest time and persisted in the `thread_id` column.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip leading `Re:`, `Fwd:`, `FW:` prefixes (case-insensitive,
 * repeating) and trim surrounding whitespace.
 */
export function normalizeSubject(s: string): string {
  let out = s;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const trimmed = out.replace(/^\s*(re|fwd|fw)\s*:\s*/i, '');
    if (trimmed === out) break;
    out = trimmed;
  }
  return out.trim();
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

/**
 * Group all macOS notifications by their source app bundle id.
 * E.g. all Slack notifications share one thread, all Outlook another.
 */
export function macosThreadId(appId: string | null): string {
  return 'macos:' + (appId ?? 'unknown');
}

// ---------------------------------------------------------------------------
// WorkIQ Outlook
// ---------------------------------------------------------------------------

export interface WorkIQOutlookThreadInput {
  conversation_id?: string | null;
  sender_email?: string | null;
  subject?: string | null;
}

/**
 * Outlook thread: prefer `conversation_id` from the SDK response,
 * fall back to `sender_email:normalizeSubject(subject)`.
 */
export function workiqOutlookThreadId(input: WorkIQOutlookThreadInput): string {
  if (input.conversation_id) {
    return 'workiq-outlook:' + input.conversation_id;
  }
  const email = input.sender_email ?? 'unknown';
  const subj = normalizeSubject(input.subject ?? '');
  return 'workiq-outlook:' + email + ':' + subj;
}

// ---------------------------------------------------------------------------
// WorkIQ Teams
// ---------------------------------------------------------------------------

export interface WorkIQTeamsThreadInput {
  channel_id?: string | null;
  thread_id_from_response?: string | null;
  sender_name?: string | null;
  subject?: string | null;
}

/**
 * Teams thread: prefer `channel_id + thread_id_from_response` from
 * the SDK, fall back to `sender_name:normalizeSubject(subject)`.
 */
export function workiqTeamsThreadId(input: WorkIQTeamsThreadInput): string {
  if (input.channel_id && input.thread_id_from_response) {
    return 'workiq-teams:' + input.channel_id + ':' + input.thread_id_from_response;
  }
  const sender = input.sender_name ?? 'unknown';
  const subj = normalizeSubject(input.subject ?? '');
  return 'workiq-teams:' + sender + ':' + subj;
}
