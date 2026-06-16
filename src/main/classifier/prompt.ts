/**
 * Phase B.2 — classifier prompt builder + response parser.
 *
 * Adapted from Funnel's `classifier.rs` (kept the spirit of its urgency
 * rubric, dropped Funnel's category-only output in favour of Harbor's
 * goal + category model). The actual LLM round-trip lives in
 * `classifier.ts`; this module is pure so it stays trivially testable.
 *
 * The LLM is asked to return a strict JSON array — even for a single
 * notification — because that's a stable shape regardless of batch size.
 * We parse defensively: extract the first `[...]` block we see, JSON.parse
 * it, then validate every per-row field.
 */

import type {
  Notification,
  Urgency,
} from '../../shared/notification-types';
import { URGENCY_VALUES } from '../../shared/notification-types';
import type { Goal, Category } from '../../shared/goal-category-types';

export const CLASSIFIER_SYSTEM_MESSAGE = `You are Harbor's notification triage classifier.

For each notification, decide:
  - category_id: which category (from the list provided) best describes it. null if none fit.
  - goal_id: which goal (from the list provided) it advances. null if none fit.
  - urgency: one of "urgent" (needs me in the next hour), "today" (needs me before end of day), "this-week" (needs me before end of week), "whenever" (no time pressure, FYI).
  - reasoning: one short sentence explaining the urgency choice. Keep it under 20 words.

Default to "whenever" unless the notification clearly demands faster action. Marketing, automated digests, and FYI traffic are almost always "whenever". A direct question, an @-mention, or a deadline reference is usually "today" or sooner.
VIP senders are people whose messages typically deserve faster response. Bias urgency upward when other signals support it, but do not over-correct; a VIP autoresponder is still low urgency.

Pick category_id and goal_id ONLY from the IDs provided. Do not invent ids. Use null if nothing fits.

Respond with ONLY a JSON array. No prose, no markdown fences. One object per input notification, in the same order, each shaped like:
[{"uid":"<source_uid>","category_id":"<id|null>","goal_id":"<id|null>","urgency":"<urgent|today|this-week|whenever>","reasoning":"<short rationale>"}]`;

export interface ClassifierHint {
  /** Heuristic-derived urgency hint. The LLM may override. */
  urgency?: Urgency;
  /** Free-text reason explaining the hint, surfaced in the prompt. */
  reason?: string;
}

/**
 * Cheap pre-LLM heuristics. Strong noise filters only — anything ambiguous
 * is left to the LLM. Returned as a hint so the LLM can override when the
 * subject/body actually carries signal (e.g. a no-reply alert that's
 * genuinely urgent).
 */
export function preClassifyHeuristics(n: Notification): ClassifierHint | null {
  const sender = `${n.sender_name ?? ''} ${n.sender_email ?? ''}`.toLowerCase();
  if (sender.includes('no-reply') || sender.includes('noreply')) {
    return { urgency: 'whenever', reason: 'sender looks automated (no-reply)' };
  }
  const body = (n.body ?? '').trim();
  if (body.length < 30 && !body.includes('?') && !(n.subject ?? '').includes('?')) {
    return { urgency: 'whenever', reason: 'very short body with no question' };
  }
  return null;
}

export interface PromptNotificationInput {
  notification: Notification;
  hint?: ClassifierHint | null;
}

/**
 * Build the user-prompt string. Caller supplies the system message
 * separately when creating the session.
 */
export function buildPrompt(
  inputs: PromptNotificationInput[],
  goals: Goal[],
  categories: Category[],
  vipEmails: ReadonlySet<string>,
): string {
  const categoryLines = categories.map(c => {
    const desc = c.description?.trim() ? ` — ${c.description.trim()}` : '';
    return `  - ${c.id}: "${c.title}"${desc}`;
  });
  const goalLines = goals.map(g => {
    const desc = g.description?.trim() ? ` — ${g.description.trim()}` : '';
    return `  - ${g.id}: "${g.title}"${desc}`;
  });

  const notifBlocks = inputs.map(({ notification: n, hint }) => {
    const senderLabel = n.sender_name
      ? n.sender_email ? `${n.sender_name} <${n.sender_email}>` : n.sender_name
      : (n.sender_email ?? n.app_id ?? n.source);
    const subject = (n.subject ?? '').trim() || '(no subject)';
    const body = truncate((n.body ?? '').trim(), 1200);
    const hintLine = hint?.urgency
      ? `\nhint: urgency=${hint.urgency}${hint.reason ? ` (${hint.reason})` : ''}`
      : '';
    const isVip = !!n.sender_email && vipEmails.has(n.sender_email.toLowerCase());
    return [
      `uid: ${n.source_uid}`,
      `source: ${n.source}`,
      `sender: ${senderLabel}`,
      ...(isVip ? ['vip: true'] : []),
      `subject: ${subject}`,
      `body: ${body}`,
      `received_at: ${n.received_at}${hintLine}`,
    ].join('\n');
  });

  const categoriesBlock = categoryLines.length
    ? `Available categories (pick by id, or null):\n${categoryLines.join('\n')}`
    : 'Available categories: (none configured — return null for category_id)';
  const goalsBlock = goalLines.length
    ? `Available goals (pick by id, or null):\n${goalLines.join('\n')}`
    : 'Available goals: (none configured — return null for goal_id)';

  return [
    categoriesBlock,
    goalsBlock,
    `Notifications to classify (${inputs.length}):`,
    notifBlocks.map((b, i) => `--- notification ${i + 1} ---\n${b}`).join('\n\n'),
    'Return the JSON array now.',
  ].join('\n\n');
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

export interface ParsedClassification {
  uid: string;
  category_id: string | null;
  goal_id: string | null;
  urgency: Urgency;
  reasoning: string | null;
}

/**
 * Extract the first JSON array from raw LLM content, then validate each
 * entry against the known goal/category ids. Returns one entry per valid
 * row. Invalid rows are silently dropped so a single bad apple doesn't
 * sink the whole batch.
 */
export function parseClassifierResponse(
  content: string,
  knownGoalIds: ReadonlySet<string>,
  knownCategoryIds: ReadonlySet<string>,
): ParsedClassification[] {
  const match = content.trim().match(/\[[\s\S]*\]/);
  if (!match) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: ParsedClassification[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const uid = typeof e.uid === 'string' ? e.uid : null;
    if (!uid) continue;
    const urgency = normalizeUrgency(e.urgency);
    if (!urgency) continue;
    const category_id = normalizeId(e.category_id, knownCategoryIds);
    const goal_id = normalizeId(e.goal_id, knownGoalIds);
    const reasoning = typeof e.reasoning === 'string' && e.reasoning.trim().length
      ? e.reasoning.trim().slice(0, 280)
      : null;
    out.push({ uid, category_id, goal_id, urgency, reasoning });
  }
  return out;
}

function normalizeUrgency(value: unknown): Urgency | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  // Accept a few synonyms the model occasionally emits.
  const aliased = v === 'now' ? 'urgent'
    : v === 'fyi' ? 'whenever'
    : v === 'this_week' ? 'this-week'
    : v;
  return (URGENCY_VALUES as readonly string[]).includes(aliased)
    ? (aliased as Urgency)
    : null;
}

function normalizeId(
  value: unknown,
  known: ReadonlySet<string>,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  return known.has(value) ? value : null;
}
