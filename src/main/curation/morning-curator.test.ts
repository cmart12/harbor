import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ai module to avoid Electron dependency
vi.mock('../ai', () => ({
  getEphemeralCopilotClient: vi.fn(),
}));

// Mock notif-db before importing morning-curator
vi.mock('../notif-db', () => ({
  createCurationRun: vi.fn().mockReturnValue({ id: 'run-123', run_type: 'manual_morning', status: 'pending', started_at: '2025-06-20T08:00:00Z', completed_at: null, source_window_start: null, source_window_end: null, summary: null, todos_created: 0, error: null }),
  updateCurationRun: vi.fn().mockReturnValue({ id: 'run-123', status: 'complete' }),
  createTodo: vi.fn().mockReturnValue({ id: 'todo-1' }),
  listTodos: vi.fn().mockReturnValue([]),
  listCurationRuns: vi.fn().mockReturnValue([]),
  getCurationRun: vi.fn().mockReturnValue({ id: 'run-123', status: 'running' }),
  listGoals: vi.fn().mockReturnValue([]),
  listCategories: vi.fn().mockReturnValue([]),
  listVipSenders: vi.fn().mockReturnValue([]),
}));

vi.mock('../ipc/typed-handler', () => ({
  sendToAllWindows: vi.fn(),
}));

vi.mock('../main-log', () => ({
  mainLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../agents/in-memory-fs-provider', () => ({
  InMemoryFsProvider: class {},
}));

vi.mock('../mcp', () => ({
  getAllMcpServers: vi.fn().mockReturnValue({ workiq: {}, slack: {} }),
}));

import {
  runMorningCuration,
  _setClientFactory,
  _resetClientFactory,
  _setMcpServersFactory,
  _resetMcpServersFactory,
  _resetProbeCache,
  _resetSession,
} from './morning-curator';
import { createCurationRun, updateCurationRun, createTodo, listTodos, listCurationRuns } from '../notif-db';
import { sendToAllWindows } from '../ipc/typed-handler';

function makeMockSession(options: { probeResponse?: string; mainResponse: { content: string; toolRequests?: unknown[] }; followUpResponse?: { content: string } }) {
  const sendAndWait = vi.fn();
  // First call is probe (if first run)
  sendAndWait.mockResolvedValueOnce({ data: { content: options.probeResponse ?? '["workiq_ask","slack_search"]' } });
  // Second call is the main curation prompt
  sendAndWait.mockResolvedValueOnce({ data: { content: options.mainResponse.content, toolRequests: options.mainResponse.toolRequests ?? [] } });
  // Third call (optional follow-up)
  if (options.followUpResponse) {
    sendAndWait.mockResolvedValueOnce({ data: { content: options.followUpResponse.content } });
  }
  return {
    sendAndWait,
    disconnect: vi.fn(),
  };
}

function makeMockClient(session: unknown) {
  return () => ({
    createSession: vi.fn().mockResolvedValue(session),
  });
}

describe('runMorningCuration', () => {
  beforeEach(() => {
    _resetProbeCache();
    _resetSession();
    vi.clearAllMocks();
    // Default: first run ever (no existing runs)
    (listCurationRuns as any).mockReturnValue([]);
    (listTodos as any).mockReturnValue([]);
  });

  afterEach(() => {
    _resetClientFactory();
    _resetMcpServersFactory();
  });

  it('completes end-to-end with valid SDK response', async () => {
    const mockResponse = JSON.stringify({
      summary: 'You have 2 meetings today and 3 action items.',
      items: [
        { kind: 'task', title: 'Reply to design review email', priority: 'today', description: 'Alice asked for feedback' },
        { kind: 'meeting_prep', title: 'Standup prep', priority: 'today', description: 'Review sprint board', linked_meeting_id: 'evt-1' },
      ],
    });

    const session = makeMockSession({ mainResponse: { content: mockResponse } });
    _setClientFactory(makeMockClient(session) as any);

    const result = await runMorningCuration();

    expect(result.runId).toBe('run-123');
    expect(result.todosCreated).toBe(2);
    expect(result.summary).toBe('You have 2 meetings today and 3 action items.');
    expect(createCurationRun).toHaveBeenCalledTimes(1);
    expect(createTodo).toHaveBeenCalledTimes(2);
    expect(updateCurationRun).toHaveBeenCalledWith('run-123', expect.objectContaining({ status: 'running' }));
    expect(updateCurationRun).toHaveBeenCalledWith('run-123', expect.objectContaining({ status: 'complete', todos_created: 2 }));
    expect(sendToAllWindows).toHaveBeenCalledWith('todos:changed');
    expect(sendToAllWindows).toHaveBeenCalledWith('curation:run-complete', expect.objectContaining({ runId: 'run-123' }));
  });

  it('uses 7-day window for kickoff run', async () => {
    const session = makeMockSession({ mainResponse: { content: JSON.stringify({ summary: 'ok', items: [] }) } });
    _setClientFactory(makeMockClient(session) as any);

    await runMorningCuration({ kickoff: true });

    const runInput = (createCurationRun as any).mock.calls[0][0];
    expect(runInput.run_type).toBe('kickoff');
    // Verify window is ~7 days (within a reasonable range)
    const start = new Date(runInput.source_window_start).getTime();
    const end = new Date(runInput.source_window_end).getTime();
    const daysDiff = (end - start) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeCloseTo(7, 0);
  });

  it('uses 12h window for normal morning run', async () => {
    // Simulate not-first run
    (listCurationRuns as any).mockReturnValue([{ id: 'prev', status: 'complete' }]);
    const session = makeMockSession({ mainResponse: { content: JSON.stringify({ summary: 'ok', items: [] }) } });
    _setClientFactory(makeMockClient(session) as any);

    await runMorningCuration();

    const runInput = (createCurationRun as any).mock.calls[0][0];
    expect(runInput.run_type).toBe('manual_morning');
    const start = new Date(runInput.source_window_start).getTime();
    const end = new Date(runInput.source_window_end).getTime();
    const hoursDiff = (end - start) / (1000 * 60 * 60);
    expect(hoursDiff).toBeCloseTo(12, 0);
  });

  it('handles SDK error gracefully and marks run as failed', async () => {
    const session = {
      sendAndWait: vi.fn()
        .mockResolvedValueOnce({ data: { content: '["workiq_ask"]' } }) // probe succeeds
        .mockRejectedValueOnce(new Error('SDK timeout')), // main call fails
      disconnect: vi.fn(),
    };
    _setClientFactory(makeMockClient(session) as any);

    await expect(runMorningCuration()).rejects.toThrow('SDK timeout');
    expect(updateCurationRun).toHaveBeenCalledWith('run-123', expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('SDK timeout'),
    }));
  });

  it('handles empty content + toolRequests via follow-up prompt', async () => {
    const session = makeMockSession({
      mainResponse: { content: '', toolRequests: [{ id: 'tr-1' }] },
      followUpResponse: { content: JSON.stringify({ summary: 'follow-up worked', items: [] }) },
    });
    _setClientFactory(makeMockClient(session) as any);

    const result = await runMorningCuration();
    expect(result.summary).toBe('follow-up worked');
    expect(session.sendAndWait).toHaveBeenCalledTimes(3); // probe + first attempt + follow-up
  });

  it('applies dedupe against existing open todos', async () => {
    (listTodos as any).mockReturnValue([
      { title: 'Review PR #123', status: 'open' },
    ]);

    const mockResponse = JSON.stringify({
      summary: 'done',
      items: [
        { kind: 'task', title: 'Review PR #123', priority: 'today' },
        { kind: 'task', title: 'Write new feature spec', priority: 'today' },
      ],
    });
    const session = makeMockSession({ mainResponse: { content: mockResponse } });
    _setClientFactory(makeMockClient(session) as any);

    const result = await runMorningCuration();
    // Only the non-duplicate should be created
    expect(result.todosCreated).toBe(1);
    expect(createTodo).toHaveBeenCalledTimes(1);
    expect((createTodo as any).mock.calls[0][0].title).toBe('Write new feature spec');
  });

  it('creates todos with triage_state=suggested and source=curation', async () => {
    const mockResponse = JSON.stringify({
      summary: 'ok',
      items: [
        { kind: 'task', title: 'Do the thing', priority: 'urgent', description: 'details here' },
      ],
    });
    const session = makeMockSession({ mainResponse: { content: mockResponse } });
    _setClientFactory(makeMockClient(session) as any);

    await runMorningCuration();

    expect(createTodo).toHaveBeenCalledWith(expect.objectContaining({
      triage_state: 'suggested',
      source: 'curation',
      curation_run_id: 'run-123',
      priority: 'urgent',
      kind: 'task',
    }));
  });
});
