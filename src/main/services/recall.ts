import { listIntents } from '../database';
import { findSimilarIntent } from '../ai';
import { notifyAllWindows } from '../notify';

export async function searchForRecall(intentId: string, description: string): Promise<void> {
  try {
    const allIntents = listIntents();
    // Exclude the intent itself, get recent ones (last 30)
    const candidates = allIntents
      .filter(i => i.id !== intentId)
      .slice(0, 30);

    if (candidates.length === 0) return;

    // Prefilter: simple word overlap scoring to narrow to top 8
    const words = new Set(description.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const scored = candidates.map(c => {
      const cWords = (c.description || '').toLowerCase().split(/\s+/);
      const overlap = cWords.filter(w => words.has(w)).length;
      return { intent: c, overlap };
    });
    scored.sort((a, b) => b.overlap - a.overlap);
    const topCandidates = scored.slice(0, 8).map(s => s.intent);

    if (topCandidates.length === 0) return;

    const match = await findSimilarIntent(description, topCandidates);
    if (match) {
      notifyAllWindows('intent:recall', intentId, match);
    }
  } catch (err) {
    console.error('[recall] Search failed:', err);
  }
}
