import { evaluateRecurrence } from '../ai';
import { updateIntentCAS, logIntentEvent } from '../database';
import { notifyAllWindows } from '../notify';
import { Intent, RecurrenceResult } from '../../shared/types';

// Track in-flight recurrence evaluations so we can cancel them
const pendingRecurrences = new Map<string, { result: RecurrenceResult; version: string; timer: ReturnType<typeof setTimeout> }>();

export async function handleRecurrence(intent: Intent, version: string): Promise<void> {
  try {
    const result = await evaluateRecurrence({
      raw_text: intent.raw_text,
      description: intent.description,
      due_at: intent.due_at,
      due_at_utc: intent.due_at_utc,
      completed_at: intent.completed_at!,
    });

    if (!result.should_recur) {
      notifyAllWindows('intent:recurrence', intent.id, result);
      return;
    }

    // Send result to renderer immediately for preview
    notifyAllWindows('intent:recurrence', intent.id, result);

    // Start undo window — apply recurrence after 5 seconds
    const timer = setTimeout(() => {
      applyRecurrence(intent.id, version, result);
      pendingRecurrences.delete(intent.id);
    }, 5000);

    pendingRecurrences.set(intent.id, { result, version, timer });
  } catch (err) {
    console.error('[recurrence] Evaluation failed:', err);
  }
}

export function applyRecurrence(intentId: string, expectedVersion: string, result: RecurrenceResult): void {
  const updated = updateIntentCAS(intentId, expectedVersion, {
    status: 'captured',
    due_at: result.next_due,
    due_at_utc: result.next_due_utc,
    recurrence: JSON.stringify(result),
  });

  if (updated) {
    logIntentEvent(intentId, 'recycled', {
      due_at: result.next_due,
      due_at_utc: result.next_due_utc,
      recurrence_json: JSON.stringify(result),
    });
    notifyAllWindows('intent:recurrence-applied', intentId);
    console.log(`[recurrence] Applied for ${intentId}: next due ${result.next_due}`);
  } else {
    console.log(`[recurrence] CAS failed for ${intentId} — intent was modified`);
  }
}

export function dismissRecurrence(intentId: string): void {
  const pending = pendingRecurrences.get(intentId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingRecurrences.delete(intentId);
    logIntentEvent(intentId, 'recurrence_dismissed', {
      recurrence_json: JSON.stringify(pending.result),
    });
    console.log(`[recurrence] Dismissed for ${intentId}`);
  }
}

export function cancelPendingRecurrence(intentId: string): void {
  const pending = pendingRecurrences.get(intentId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingRecurrences.delete(intentId);
  }
}

export function hasPendingRecurrence(intentId: string): boolean {
  return pendingRecurrences.has(intentId);
}
