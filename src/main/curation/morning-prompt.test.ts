import { describe, it, expect } from 'vitest';
import { buildMorningPrompt, CURATION_SYSTEM_MESSAGE } from './morning-prompt';
import type { MorningPromptInput } from './morning-prompt';
import type { Todo } from '../../shared/todo-types';

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'test-id',
    title: 'Test todo',
    description: null,
    status: 'open',
    source: 'manual',
    curation_run_id: null,
    evidence_uids: null,
    goal_id: null,
    category_id: null,
    priority: 'whenever',
    due_at: null,
    snoozed_until: null,
    space_id: null,
    kind: 'task',
    linked_meeting_id: null,
    triage_state: 'triaged',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

describe('buildMorningPrompt', () => {
  const baseInput: MorningPromptInput = {
    windowStart: '2025-06-19T20:00:00Z',
    windowEnd: '2025-06-20T08:00:00Z',
    existingOpenTodos: [],
    categories: [],
    goals: [],
    vips: [],
  };

  it('includes window start and end in the prompt', () => {
    const prompt = buildMorningPrompt(baseInput);
    expect(prompt).toContain('2025-06-19T20:00:00Z');
    expect(prompt).toContain('2025-06-20T08:00:00Z');
  });

  it('requests JSON array output with items schema', () => {
    const prompt = buildMorningPrompt(baseInput);
    expect(prompt).toContain('"items"');
    expect(prompt).toContain('"kind"');
    expect(prompt).toContain('"task" | "meeting_prep"');
    expect(prompt).toContain('"summary"');
  });

  it('includes categories when provided', () => {
    const input: MorningPromptInput = {
      ...baseInput,
      categories: [
        { id: 'cat-1', title: 'Engineering', description: null, color: '#FF0000', sort_order: 0, archived_at: null, created_at: '', updated_at: '' },
      ],
    };
    const prompt = buildMorningPrompt(input);
    expect(prompt).toContain('cat-1');
    expect(prompt).toContain('Engineering');
  });

  it('includes goals when provided', () => {
    const input: MorningPromptInput = {
      ...baseInput,
      goals: [
        { id: 'goal-1', title: 'Ship v2', description: null, color: '#00FF00', sort_order: 0, archived_at: null, created_at: '', updated_at: '' },
      ],
    };
    const prompt = buildMorningPrompt(input);
    expect(prompt).toContain('goal-1');
    expect(prompt).toContain('Ship v2');
  });

  it('includes VIPs when provided', () => {
    const input: MorningPromptInput = {
      ...baseInput,
      vips: [
        { email: 'boss@corp.com', display_name: 'The Boss', id: 'v1', created_at: '' },
      ],
    };
    const prompt = buildMorningPrompt(input);
    expect(prompt).toContain('boss@corp.com');
    expect(prompt).toContain('The Boss');
  });

  it('includes existing todo titles for dedupe guidance', () => {
    const input: MorningPromptInput = {
      ...baseInput,
      existingOpenTodos: [
        makeTodo({ title: 'Review PR #123' }),
        makeTodo({ title: 'Update docs' }),
      ],
    };
    const prompt = buildMorningPrompt(input);
    expect(prompt).toContain('Review PR #123');
    expect(prompt).toContain('Update docs');
    expect(prompt).toContain('do NOT duplicate');
  });

  it('includes probed tool names when provided', () => {
    const input: MorningPromptInput = {
      ...baseInput,
      probedTools: ['calendar_list_events', 'mail_search', 'transcripts_search'],
    };
    const prompt = buildMorningPrompt(input);
    expect(prompt).toContain('calendar_list_events');
    expect(prompt).toContain('mail_search');
    expect(prompt).toContain('transcripts_search');
  });

  it('uses fallback tool instructions when no probed tools', () => {
    const prompt = buildMorningPrompt(baseInput);
    expect(prompt).toContain('whatever calendar, email, messaging, and transcript tools');
  });

  it('system message is stable and non-empty', () => {
    expect(CURATION_SYSTEM_MESSAGE).toBeTruthy();
    expect(CURATION_SYSTEM_MESSAGE).toContain('productivity assistant');
  });

  it('includes emphatic evidence_uids instruction with example', () => {
    const prompt = buildMorningPrompt(baseInput);
    expect(prompt).toContain('evidence_uids');
    expect(prompt).toContain('MUST include the source');
    expect(prompt).toContain('source_uid');
    expect(prompt).toContain('open the source in one click');
    // Verify example JSON is present
    expect(prompt).toContain('"evidence_uids": ["msft-graph-msg-AAMkADRiYWI5OGRm"');
  });
});
