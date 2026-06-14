import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../ai', () => ({
  parseSpaceWithAI: vi.fn(),
}));

vi.mock('../database', () => ({
  updateSpaceCAS: vi.fn(),
}));

vi.mock('../config', () => ({
  getConfigValue: vi.fn(() => null),
}));

vi.mock('../workspace', () => ({
  scheduleAutoCommit: vi.fn(),
}));

vi.mock('../notify', () => ({
  notifyAllWindows: vi.fn(),
}));

vi.mock('./recall', () => ({
  searchForRecall: vi.fn(),
}));

import { parseSpaceWithAI } from '../ai';
import { updateSpaceCAS } from '../database';
import { processSpaceInBackground } from './space-processing';

describe('space processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not overwrite the markdown-derived space title', async () => {
    vi.mocked(parseSpaceWithAI).mockResolvedValueOnce({
      description: 'AI title',
      client: 'Acme',
      due_at: 'tomorrow',
      due_at_utc: '2026-01-01T00:00:00.000Z',
    });

    await processSpaceInBackground('space-1', '# User title\n\nBody', 'version-1');

    expect(updateSpaceCAS).toHaveBeenCalledWith('space-1', 'version-1', {
      client: 'Acme',
      due_at: 'tomorrow',
      due_at_utc: '2026-01-01T00:00:00.000Z',
    });
  });
});
