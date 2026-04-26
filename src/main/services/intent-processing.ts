import { parseIntentWithAI } from '../ai';
import { updateIntentCAS } from '../database';
import { getConfigValue } from '../config';
import { scheduleAutoCommit } from '../workspace';
import { notifyAllWindows } from '../notify';
import { searchForRecall } from './recall';

export async function processIntentInBackground(id: string, body: string, createdVersion: string): Promise<void> {
  try {
    const parsed = await parseIntentWithAI(body);
    // CAS: only apply AI results if intent hasn't been edited since creation
    updateIntentCAS(id, createdVersion, {
      description: parsed.description,
      client: parsed.client,
      due_at: parsed.due_at,
      due_at_utc: parsed.due_at_utc,
    });
    notifyAllWindows('intent:processed', id);

    const workspace = getConfigValue('workspace');
    if (workspace) scheduleAutoCommit(workspace);

    // After refinement, search for similar past intents (recall)
    searchForRecall(id, parsed.description);
  } catch (err) {
    console.error('[intent-processing] Background processing failed:', err);
  }
}
