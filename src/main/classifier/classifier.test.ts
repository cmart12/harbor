import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Notification } from '../../shared/notification-types';
import type { Goal, Category } from '../../shared/goal-category-types';

// ---------------------------------------------------------------------------
// Module-level mocks: DB + sendToAllWindows + ai. Done above the SUT import
// so they take effect for the import-time bindings in classifier.ts.
// ---------------------------------------------------------------------------

const dbState: {
  notifications: Map<string, Notification>;
  goals: Goal[];
  categories: Category[];
  classified: Array<{ uid: string; payload: unknown }>;
  failed: string[];
  pending: string[];
  attempts: Map<string, number>;
} = {
  notifications: new Map(),
  goals: [],
  categories: [],
  classified: [],
  failed: [],
  pending: [],
  attempts: new Map(),
};

vi.mock('../notif-db', () => ({
  getNotification: (uid: string) => dbState.notifications.get(uid),
  setClassification: (uid: string, payload: unknown) => {
    dbState.classified.push({ uid, payload });
    const existing = dbState.notifications.get(uid);
    if (existing) {
      const p = payload as { category_id: string | null; goal_id: string | null; urgency: 'urgent' | 'today' | 'this-week' | 'whenever'; reasoning: string | null };
      dbState.notifications.set(uid, {
        ...existing,
        category_id: p.category_id,
        goal_id: p.goal_id,
        urgency: p.urgency,
        classification_status: 'done',
        classification_reasoning: p.reasoning,
        classified_at: '2026-06-15T10:00:00Z',
      });
    }
  },
  incrementClassificationAttempts: (uid: string) => {
    dbState.attempts.set(uid, (dbState.attempts.get(uid) ?? 0) + 1);
  },
  markClassificationFailed: (uid: string) => {
    dbState.failed.push(uid);
    const existing = dbState.notifications.get(uid);
    if (existing) {
      dbState.notifications.set(uid, { ...existing, classification_status: 'failed' });
    }
  },
  markClassificationPending: (uid: string) => {
    dbState.pending.push(uid);
  },
  listPendingClassifications: () => [],
  pendingClassificationCount: () => 0,
  failedClassificationCount: () => dbState.failed.length,
  resetAllClassifications: () => 0,
  resetFailedClassifications: () => 0,
  listGoals: () => dbState.goals,
  listCategories: () => dbState.categories,
}));

const sentEvents: Array<{ channel: string; payload: unknown }> = [];
vi.mock('../ipc/typed-handler', () => ({
  sendToAllWindows: (channel: string, payload: unknown) => {
    sentEvents.push({ channel, payload });
  },
  registerHandler: () => { /* no-op for these tests */ },
}));

vi.mock('../ai', () => ({
  getEphemeralCopilotClient: () => null,
}));

// Now import the SUT. (Imports below the vi.mock calls so mocks are wired.)
const classifier = await import('./classifier');

function makeNotification(uid: string, overrides: Partial<Notification> = {}): Notification {
  return {
    source_uid: uid,
    source: 'macos',
    received_at: '2026-06-15T10:00:00Z',
    inserted_at: '2026-06-15T10:00:00Z',
    sender_name: 'Alice',
    sender_email: 'alice@example.com',
    subject: 'subj',
    body: 'a body that is long enough to dodge the heuristic gate',
    app_id: null,
    link_url: null,
    has_attachments: 0,
    status: 'active',
    promoted_to_space_id: null,
    snoozed_until: null,
    raw_json: null,
    category_id: null,
    goal_id: null,
    urgency: 'whenever',
    classification_status: 'pending',
    classification_attempts: 0,
    classified_at: null,
    classification_reasoning: null,
    ...overrides,
  };
}

function resetDbState(): void {
  dbState.notifications.clear();
  dbState.goals = [];
  dbState.categories = [];
  dbState.classified = [];
  dbState.failed = [];
  dbState.pending = [];
  dbState.attempts.clear();
  sentEvents.length = 0;
}

/** Build a fake SDK client whose session emits a canned content payload. */
function fakeClient(contentFn: (prompt: string) => string) {
  const sendAndWait = vi.fn(async ({ prompt }: { prompt: string }) => {
    return { data: { content: contentFn(prompt) } };
  });
  const session = { sendAndWait, disconnect: vi.fn() };
  const createSession = vi.fn(async () => session);
  return {
    client: { createSession } as unknown as ReturnType<typeof Object>,
    sendAndWait,
    createSession,
  };
}

beforeEach(() => {
  resetDbState();
  classifier._resetForTests();
  classifier._setSleepFn(async () => { /* no waiting in tests */ });
});

describe('enqueueForClassification', () => {
  it('calls the SDK once per uid and persists the parsed result', async () => {
    const n = makeNotification('uid-1');
    dbState.notifications.set('uid-1', n);
    const { client, sendAndWait } = fakeClient(() => JSON.stringify([
      { uid: 'uid-1', category_id: null, goal_id: null, urgency: 'today', reasoning: 'because' },
    ]));
    classifier._setClientFactory(() => client as any);

    classifier.enqueueForClassification('uid-1');
    // Drain the queue
    await classifier.enqueueForClassification('uid-1') as unknown;
    // Pump microtasks
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(sendAndWait).toHaveBeenCalledTimes(1);
    expect(dbState.classified).toEqual([{
      uid: 'uid-1',
      payload: { category_id: null, goal_id: null, urgency: 'today', reasoning: 'because' },
    }]);
    expect(sentEvents.some(e => e.channel === 'notification:updated')).toBe(true);
  });

  it('deduplicates the same uid queued twice in the same tick', async () => {
    const n = makeNotification('uid-1');
    dbState.notifications.set('uid-1', n);
    const { client, sendAndWait } = fakeClient(() => JSON.stringify([
      { uid: 'uid-1', urgency: 'whenever' },
    ]));
    classifier._setClientFactory(() => client as any);

    classifier.enqueueForClassification('uid-1');
    classifier.enqueueForClassification('uid-1');
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(sendAndWait).toHaveBeenCalledTimes(1);
  });
});

describe('enqueueManyForClassification batching', () => {
  it('drains many uids in at most ceil(N/BATCH_SIZE) calls', async () => {
    const uids: string[] = [];
    for (let i = 0; i < classifier.BATCH_SIZE + 5; i++) {
      const uid = `uid-${i}`;
      uids.push(uid);
      dbState.notifications.set(uid, makeNotification(uid));
    }

    const { client, sendAndWait } = fakeClient((prompt) => {
      // Echo back one entry per uid mentioned in the prompt.
      const matches = [...prompt.matchAll(/uid:\s*(uid-\d+)/g)].map(m => m[1]);
      return JSON.stringify(matches.map(uid => ({
        uid, category_id: null, goal_id: null, urgency: 'whenever', reasoning: null,
      })));
    });
    classifier._setClientFactory(() => client as any);

    classifier.enqueueManyForClassification(uids);
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));

    expect(sendAndWait).toHaveBeenCalledTimes(2);
    expect(dbState.classified.length).toBe(uids.length);
  });
});

describe('retry policy', () => {
  it('retries up to 3 times when the response is unparseable, then marks failed', async () => {
    const n = makeNotification('uid-fail');
    dbState.notifications.set('uid-fail', n);
    const { client, sendAndWait } = fakeClient(() => 'not valid json at all');
    classifier._setClientFactory(() => client as any);

    classifier.enqueueForClassification('uid-fail');
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

    expect(sendAndWait).toHaveBeenCalledTimes(3);
    expect(dbState.failed).toContain('uid-fail');
    expect(dbState.attempts.get('uid-fail')).toBe(3);
    expect(sentEvents.some(e => e.channel === 'notification:updated')).toBe(true);
  });

  it('falls back to heuristic urgency when LLM omits a row in a batch response', async () => {
    dbState.notifications.set('uid-a', makeNotification('uid-a'));
    dbState.notifications.set('uid-b', makeNotification('uid-b', { sender_email: 'noreply@x.com' }));

    // LLM returns only one row of two.
    const { client } = fakeClient(() => JSON.stringify([
      { uid: 'uid-a', category_id: null, goal_id: null, urgency: 'urgent', reasoning: 'real' },
    ]));
    classifier._setClientFactory(() => client as any);

    classifier.enqueueManyForClassification(['uid-a', 'uid-b']);
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));

    const persistedA = dbState.classified.find(c => c.uid === 'uid-a');
    const persistedB = dbState.classified.find(c => c.uid === 'uid-b');
    expect(persistedA && (persistedA.payload as any).urgency).toBe('urgent');
    expect(persistedB && (persistedB.payload as any).urgency).toBe('whenever');
  });
});

describe('pendingCount / failedCount', () => {
  it('exposes the DB-derived counts', () => {
    expect(classifier.pendingCount()).toBe(0);
    expect(classifier.failedCount()).toBe(0);
    dbState.failed.push('uid-x');
    expect(classifier.failedCount()).toBe(1);
  });
});

describe('reclassifyOne', () => {
  it('resets the row to pending and runs the classifier', async () => {
    dbState.notifications.set('uid-z', makeNotification('uid-z', {
      classification_status: 'done',
    }));
    const { client, sendAndWait } = fakeClient(() => JSON.stringify([
      { uid: 'uid-z', category_id: null, goal_id: null, urgency: 'this-week', reasoning: 'fresh' },
    ]));
    classifier._setClientFactory(() => client as any);

    await classifier.reclassifyOne('uid-z');

    expect(dbState.pending).toContain('uid-z');
    expect(sendAndWait).toHaveBeenCalledTimes(1);
    expect(dbState.classified.find(c => c.uid === 'uid-z')).toBeDefined();
  });
});

describe('SDK unavailable', () => {
  it('treats a null client as a transient error and retries to failure', async () => {
    dbState.notifications.set('uid-nosdk', makeNotification('uid-nosdk'));
    classifier._setClientFactory(() => null);

    classifier.enqueueForClassification('uid-nosdk');
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

    expect(dbState.failed).toContain('uid-nosdk');
  });
});
