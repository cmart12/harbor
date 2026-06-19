/**
 * Morning curation prompt builder (Phase E.2a).
 *
 * Constructs the system message and user prompt for the SDK session
 * that gathers today's context (calendar, email, Teams, Slack,
 * transcripts) and extracts action items + meeting prep notes.
 */

import type { Todo } from '../../shared/todo-types';
import type { Category } from '../../shared/goal-category-types';
import type { Goal } from '../../shared/goal-category-types';
import type { VipSender } from '../../shared/notification-types';

export interface MorningPromptInput {
  windowStart: string;
  windowEnd: string;
  existingOpenTodos: Todo[];
  categories: Category[];
  goals: Goal[];
  vips: VipSender[];
  probedTools?: string[];
}

export const CURATION_SYSTEM_MESSAGE = `You are a personal productivity assistant. Your job is to gather context from the user's Microsoft 365 (via WorkIQ MCP) and Slack (via Slack MCP), then extract action items and meeting preparation notes.

Return ONLY valid JSON matching the schema described in the user prompt. No markdown fences, no prose outside the JSON.`;

export function buildMorningPrompt(input: MorningPromptInput): string {
  const {
    windowStart,
    windowEnd,
    existingOpenTodos,
    categories,
    goals,
    vips,
    probedTools,
  } = input;

  const toolInstructions = buildToolInstructions(probedTools);
  const existingTodosSummary = buildExistingTodosSummary(existingOpenTodos);
  const contextBlock = buildContextBlock(categories, goals, vips);

  return `## Task

Gather context from the time window ${windowStart} to ${windowEnd} and extract:
1. Action items the user is responsible for
2. Per-meeting preparation notes for today's upcoming meetings
3. Anything urgent from overnight

${toolInstructions}

## Instructions

- Use the available MCP tools to fetch:
  1. Today's calendar meetings (start time, attendees, subject)
  2. Emails and Teams messages received since ${windowStart}
  3. Meeting transcripts from the prior day (or within the window)
  4. Recent Slack messages in channels the user is active in

- From the gathered data, identify:
  - Tasks assigned to or expected of the user
  - Questions awaiting the user's response
  - Meeting prep: key context, agenda items, or decisions needed for each upcoming meeting
  - Anything flagged as urgent or time-sensitive

${contextBlock}

${existingTodosSummary}

## Output Schema

Return a JSON object with this exact shape:

\`\`\`json
{
  "summary": "A 2-4 sentence narrative summarizing today's prep and key items",
  "items": [
    {
      "kind": "task" | "meeting_prep",
      "title": "Short actionable title (max 120 chars)",
      "description": "Context and details (max 800 chars)",
      "priority": "urgent" | "today" | "this_week" | "whenever",
      "category_id": "id or null",
      "goal_id": "id or null",
      "linked_meeting_id": "calendar event ID if meeting_prep, else null",
      "evidence_uids": ["source identifiers for traceability"]
    }
  ]
}
\`\`\`

Rules:
- "kind" must be either "task" or "meeting_prep"
- "priority" must be one of: "urgent", "today", "this_week", "whenever"
- For meeting_prep items, set linked_meeting_id to the calendar event identifier
- Assign category_id and goal_id when you can match against the provided lists
- Keep titles concise and actionable (imperative verb + object)
- Keep descriptions under 800 characters
- Do NOT duplicate items that already exist in the user's open to-do list
- Return ONLY the JSON object, no surrounding text`;
}

function buildToolInstructions(probedTools?: string[]): string {
  if (!probedTools || probedTools.length === 0) {
    return `## Available Tools

Use whatever calendar, email, messaging, and transcript tools are available from the WorkIQ and Slack MCP servers.`;
  }

  const lines = ['## Available Tools', '', 'The following tools are available:'];
  for (const tool of probedTools) {
    lines.push(`- ${tool}`);
  }

  // Add specific guidance based on discovered tools
  const hasCalendar = probedTools.some(t => t.toLowerCase().includes('calendar') || t.toLowerCase().includes('event'));
  const hasTranscripts = probedTools.some(t => t.toLowerCase().includes('transcript'));
  const hasMessages = probedTools.some(t => t.toLowerCase().includes('message') || t.toLowerCase().includes('mail'));

  lines.push('');
  if (hasCalendar) {
    lines.push('Use the calendar tools to fetch today\'s meetings with attendees and subjects.');
  }
  if (hasTranscripts) {
    lines.push('Use the transcript tools to fetch yesterday\'s meeting transcripts for action items.');
  }
  if (hasMessages) {
    lines.push('Use the messaging/mail tools to find emails and messages received in the time window.');
  }

  return lines.join('\n');
}

function buildExistingTodosSummary(todos: Todo[]): string {
  if (todos.length === 0) return '';

  const lines = [
    '## Existing Open To-Dos (do NOT duplicate these)',
    '',
  ];

  const shown = todos.slice(0, 30);
  for (const t of shown) {
    lines.push(`- ${t.title}`);
  }
  if (todos.length > 30) {
    lines.push(`- ... and ${todos.length - 30} more`);
  }

  return lines.join('\n');
}

function buildContextBlock(
  categories: Category[],
  goals: Goal[],
  vips: VipSender[],
): string {
  const lines: string[] = [];

  if (categories.length > 0) {
    lines.push('## Categories (assign category_id when matching)');
    lines.push('');
    for (const c of categories) {
      lines.push(`- id: "${c.id}" | title: "${c.title}"`);
    }
    lines.push('');
  }

  if (goals.length > 0) {
    lines.push('## Goals (assign goal_id when matching)');
    lines.push('');
    for (const g of goals) {
      lines.push(`- id: "${g.id}" | title: "${g.title}"`);
    }
    lines.push('');
  }

  if (vips.length > 0) {
    lines.push('## VIP Senders (bias urgency upward when signals support it)');
    lines.push('');
    for (const v of vips) {
      const name = v.display_name ? ` (${v.display_name})` : '';
      lines.push(`- ${v.email}${name}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
