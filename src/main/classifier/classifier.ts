/**
 * Phase B.2 — classifier orchestrator.
 *
 * Owns the single-flight queue that hands notifications to the Copilot
 * SDK and writes the result back to the sidecar DB. Lives in the main
 * process: the macOS worker stays focused on reading Notification
 * Center, and the classifier reads from the sidecar after insert.
 *
 * Concurrency model:
 *   - One Promise chain ("queue") so only one SDK round-trip is in
 *     flight at a time. Keeps cost predictable and respects Copilot's
 *     rate limits.
 *   - Burst protection: callers can enqueue many uids in the same tick;
 *     the worker drains them in batches of up to BATCH_SIZE per SDK call.
 *   - Failure handling: 3 attempts with exponential backoff (1s/5s/30s),
 *     then `classification_status='failed'`. Failed rows are visible to
 *     the Settings "Retry failed" sweep.
 *
 * Public surface mirrors what the brief asks for so IPC handlers stay
 * thin pass-throughs.
 */

import type { CopilotClient, CopilotSession } from '@github/copilot-sdk';
import type { Notification } from '../../shared/notification-types';
import { getEphemeralCopilotClient } from '../ai';
import {
  getNotification,
  setClassification,
  markClassificationFailed,
  markClassificationPending,
  incrementClassificationAttempts,
  listPendingClassifications,
  pendingClassificationCount,
  failedClassificationCount,
  resetAllClassifications,
  resetFailedClassifications,
  listGoals,
  listCategories,
} from '../notif-db';
import { sendToAllWindows } from '../ipc/typed-handler';
import {
  buildPrompt,
  preClassifyHeuristics,
  parseClassifierResponse,
  CLASSIFIER_SYSTEM_MESSAGE,
  type ParsedClassification,
  type PromptNotificationInput,
} from './prompt';

/** Max notifications per single SDK call. Larger batches save round-trips
 * but tax the model's context window; 25 keeps each prompt well under a
 * page of text. */
export const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 5_000, 30_000];
const SDK_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// Injection seams (let tests swap the SDK without faking the whole module).
// ---------------------------------------------------------------------------

type ClientFactory = () => CopilotClient | null;
let clientFactory: ClientFactory = getEphemeralCopilotClient;
let sleepFn: (ms: number) => Promise<void> = (ms) =>
  new Promise(resolve => setTimeout(resolve, ms));

/** Test-only: replace the SDK client factory with a mock. */
export function _setClientFactory(factory: ClientFactory): void {
  clientFactory = factory;
}
/** Test-only: collapse backoff sleeps so retries finish in one tick. */
export function _setSleepFn(fn: (ms: number) => Promise<void>): void {
  sleepFn = fn;
}
/** Test-only: restore defaults between cases. */
export function _resetForTests(): void {
  clientFactory = getEphemeralCopilotClient;
  sleepFn = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  queueTail = Promise.resolve();
  pendingUids.clear();
  cachedSession = null;
}

// ---------------------------------------------------------------------------
// Single-flight queue
// ---------------------------------------------------------------------------

let queueTail: Promise<void> = Promise.resolve();
const pendingUids = new Set<string>();
let cachedSession: CopilotSession | null = null;

/** Run `task` after every previously queued task finishes. Errors are
 * swallowed so one bad classification doesn't poison the chain. */
function enqueue(task: () => Promise<void>): Promise<void> {
  const next = queueTail.then(() => task().catch(err => {
    console.warn('[classifier] task threw:', err);
  }));
  queueTail = next;
  return next;
}

async function getSession(): Promise<CopilotSession | null> {
  if (cachedSession) return cachedSession;
  const client = clientFactory();
  if (!client) return null;
  try {
    cachedSession = await client.createSession({
      systemMessage: { content: CLASSIFIER_SYSTEM_MESSAGE },
      onPermissionRequest: async () => ({ kind: 'reject' as const }),
    });
    return cachedSession;
  } catch (err) {
    console.warn('[classifier] createSession failed:', err);
    return null;
  }
}

/** Reset the cached session — called when the SDK reports a fatal error
 * so the next attempt can rebuild from scratch. */
function dropSession(): void {
  if (cachedSession) {
    try { void cachedSession.disconnect(); } catch { /* ignore */ }
  }
  cachedSession = null;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Queue one notification for classification. Coalesces duplicate uids. */
export function enqueueForClassification(uid: string): void {
  if (pendingUids.has(uid)) return;
  pendingUids.add(uid);
  void enqueue(async () => {
    pendingUids.delete(uid);
    const n = getNotification(uid);
    if (!n) return;
    await classifyAndPersist([n]);
  });
}

/** Queue many at once — the worker batches them into a single SDK call.
 * Caller stays cheap (no awaits per uid), which keeps the macOS poller
 * hot path predictable. */
export function enqueueManyForClassification(uids: string[]): void {
  const fresh = uids.filter(u => !pendingUids.has(u));
  if (fresh.length === 0) return;
  for (const u of fresh) pendingUids.add(u);
  void enqueue(async () => {
    const notifications: Notification[] = [];
    for (const uid of fresh) {
      pendingUids.delete(uid);
      const n = getNotification(uid);
      if (n) notifications.push(n);
    }
    if (notifications.length === 0) return;
    for (let i = 0; i < notifications.length; i += BATCH_SIZE) {
      const slice = notifications.slice(i, i + BATCH_SIZE);
      await classifyAndPersist(slice);
    }
  });
}

/** Manual: classify one specific notification (used by the per-row
 * "Reclassify" action). Resets the row to pending first so retries
 * start from a clean slate. */
export async function reclassifyOne(uid: string): Promise<void> {
  markClassificationPending(uid);
  return new Promise<void>((resolve) => {
    pendingUids.add(uid);
    void enqueue(async () => {
      pendingUids.delete(uid);
      const n = getNotification(uid);
      if (n) await classifyAndPersist([n]);
      resolve();
    });
  });
}

/** Manual: reset every notification to pending and run the queue. Used
 * by the Settings "Reclassify all" button. Returns the number of rows
 * that got queued. */
export function reclassifyAll(): { queued: number } {
  const queued = resetAllClassifications();
  sweepPending();
  return { queued };
}

/** Manual: retry only the rows that previously hit `failed`. */
export function retryFailed(): { queued: number } {
  const queued = resetFailedClassifications();
  sweepPending();
  return { queued };
}

/** Pull every pending row off the DB and enqueue it. Called by the
 * reclassify-all/retry-failed flows, and by the periodic retry sweep. */
export function sweepPending(): void {
  const pending = listPendingClassifications(500);
  if (pending.length === 0) return;
  enqueueManyForClassification(pending.map(n => n.source_uid));
}

export function pendingCount(): number {
  return pendingClassificationCount();
}

export function failedCount(): number {
  return failedClassificationCount();
}

// ---------------------------------------------------------------------------
// Internal: classify + retry
// ---------------------------------------------------------------------------

async function classifyAndPersist(notifications: Notification[]): Promise<void> {
  if (notifications.length === 0) return;

  const goals = safeListGoals();
  const categories = safeListCategories();
  const knownGoalIds = new Set(goals.map(g => g.id));
  const knownCategoryIds = new Set(categories.map(c => c.id));

  const inputs: PromptNotificationInput[] = notifications.map(n => ({
    notification: n,
    hint: preClassifyHeuristics(n),
  }));

  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    try {
      const parsed = await runOnce(inputs, goals, categories, knownGoalIds, knownCategoryIds);
      if (parsed.length === 0) {
        throw new Error('classifier returned no parseable rows');
      }
      applyParsed(notifications, inputs, parsed);
      emitProgress();
      return;
    } catch (err) {
      lastErr = err;
      // Bump attempts on each notification so the DB reflects retry state
      // even if we crash before the next attempt.
      for (const n of notifications) incrementClassificationAttempts(n.source_uid);
      console.warn(`[classifier] attempt ${attempt} failed:`, err);
      if (attempt < MAX_ATTEMPTS) {
        const delay = BACKOFF_MS[attempt - 1] ?? 30_000;
        await sleepFn(delay);
      }
    }
  }

  console.warn('[classifier] giving up after retries:', lastErr);
  for (const n of notifications) {
    markClassificationFailed(n.source_uid);
    const refreshed = getNotification(n.source_uid);
    if (refreshed) sendToAllWindows('notification:updated', refreshed);
  }
  emitProgress();
}

async function runOnce(
  inputs: PromptNotificationInput[],
  goals: ReturnType<typeof safeListGoals>,
  categories: ReturnType<typeof safeListCategories>,
  knownGoalIds: ReadonlySet<string>,
  knownCategoryIds: ReadonlySet<string>,
): Promise<ParsedClassification[]> {
  const session = await getSession();
  if (!session) throw new Error('Copilot SDK client unavailable');
  const prompt = buildPrompt(inputs, goals, categories);
  let response: { data?: { content?: string } } | null = null;
  try {
    response = await session.sendAndWait({ prompt }, SDK_TIMEOUT_MS) as
      { data?: { content?: string } } | null;
  } catch (err) {
    // Treat transport failures as fatal for the cached session — next
    // attempt rebuilds it.
    dropSession();
    throw err;
  }
  const content = response?.data?.content ?? '';
  return parseClassifierResponse(content, knownGoalIds, knownCategoryIds);
}

function applyParsed(
  notifications: Notification[],
  inputs: PromptNotificationInput[],
  parsed: ParsedClassification[],
): void {
  const byUid = new Map(parsed.map(p => [p.uid, p]));
  for (let i = 0; i < notifications.length; i++) {
    const n = notifications[i];
    const hit = byUid.get(n.source_uid);
    if (hit) {
      setClassification(n.source_uid, {
        category_id: hit.category_id,
        goal_id: hit.goal_id,
        urgency: hit.urgency,
        reasoning: hit.reasoning,
      });
    } else {
      // LLM didn't return a row for this uid — fall back to the
      // heuristic hint so we at least have an urgency, and mark done so
      // we don't retry this notification forever.
      const hintUrgency = inputs[i]?.hint?.urgency ?? 'whenever';
      const hintReason = inputs[i]?.hint?.reason ?? 'classifier omitted this row';
      setClassification(n.source_uid, {
        category_id: null,
        goal_id: null,
        urgency: hintUrgency,
        reasoning: hintReason,
      });
    }
    const refreshed = getNotification(n.source_uid);
    if (refreshed) sendToAllWindows('notification:updated', refreshed);
  }
}

function safeListGoals(): ReturnType<typeof listGoals> {
  try { return listGoals({ includeArchived: false }); } catch { return []; }
}

function safeListCategories(): ReturnType<typeof listCategories> {
  try { return listCategories({ includeArchived: false }); } catch { return []; }
}

function emitProgress(): void {
  const pending = pendingClassificationCount();
  const failed = failedClassificationCount();
  sendToAllWindows('classifier:progress', { pending, failed });
}

// ---------------------------------------------------------------------------
// Periodic retry sweep — picks up rows that stayed pending across a
// restart, or that briefly failed mid-attempt. Cheap (just COUNT + a
// LIMIT 500 read) so we can poll often.
// ---------------------------------------------------------------------------

let sweepTimer: NodeJS.Timeout | null = null;
const SWEEP_INTERVAL_MS = 60_000;

export function startClassifierSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    try { sweepPending(); } catch (err) {
      console.warn('[classifier] sweep failed:', err);
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  // Kick once on boot so any pending rows from a previous run get picked up.
  try { sweepPending(); } catch (err) {
    console.warn('[classifier] initial sweep failed:', err);
  }
}

export function stopClassifierSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
