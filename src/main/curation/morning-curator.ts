/**
 * Morning Curator orchestrator (Phase E.2a).
 *
 * Owns the Copilot SDK session dedicated to morning curation. On each
 * run it: builds a prompt (with window, context, probed tool list),
 * sends it to the model via `session.sendAndWait`, parses the JSON
 * result, deduplicates against existing open to-dos, persists surviving
 * candidates, and updates the `curation_runs` row.
 *
 * The session is cached for the process lifetime (dropped on error,
 * rebuilt on next attempt) - same pattern as workiq-source.ts.
 */

import type { CopilotSession } from '@github/copilot-sdk';
import { getEphemeralCopilotClient } from '../ai';
import { InMemoryFsProvider } from '../agents/in-memory-fs-provider';
import { getAllMcpServers } from '../mcp';
import {
  createCurationRun,
  updateCurationRun,
  createTodo,
  listTodos,
  listCurationRuns,
  listGoals,
  listCategories,
  listVipSenders,
} from '../notif-db';
import { sendToAllWindows } from '../ipc/typed-handler';
import { mainLog } from '../main-log';
import { curationApprovalHandler } from './curation-approval';
import { buildMorningPrompt, CURATION_SYSTEM_MESSAGE } from './morning-prompt';
import type { CurationRun, CreateTodoInput, TodoPriority, TodoKind } from '../../shared/todo-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SDK_TIMEOUT_MS = 180_000; // 3 min
const MORNING_WINDOW_HOURS = 12;
const KICKOFF_WINDOW_DAYS = 7;
const MAX_TITLE_LEN = 120;
const MAX_DESC_LEN = 800;
const DEDUPE_LEVENSHTEIN_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Injection seams (tests swap the SDK client factory)
// ---------------------------------------------------------------------------

type ClientFactory = typeof getEphemeralCopilotClient;
let clientFactory: ClientFactory = getEphemeralCopilotClient;

type McpServersFactory = typeof getAllMcpServers;
let mcpServersFactory: McpServersFactory = getAllMcpServers;

/** Test-only: replace the SDK client factory. */
export function _setClientFactory(factory: ClientFactory): void {
  clientFactory = factory;
}
/** Test-only: restore default factory. */
export function _resetClientFactory(): void {
  clientFactory = getEphemeralCopilotClient;
}
/** Test-only: replace MCP servers discovery. */
export function _setMcpServersFactory(factory: McpServersFactory): void {
  mcpServersFactory = factory;
}
export function _resetMcpServersFactory(): void {
  mcpServersFactory = getAllMcpServers;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

let cachedSession: CopilotSession | null = null;
let probedTools: string[] | null = null;

async function getSession(): Promise<CopilotSession | null> {
  if (cachedSession) return cachedSession;
  const client = clientFactory();
  if (!client) return null;

  // Discover both workiq and slack MCP servers
  let mcpServers: Record<string, unknown> = {};
  try {
    const all = mcpServersFactory();
    if (all['workiq']) mcpServers['workiq'] = all['workiq'];
    if (all['slack']) mcpServers['slack'] = all['slack'];
    if (Object.keys(mcpServers).length === 0) {
      mainLog.warn('[curation] no workiq/slack MCP servers discovered');
    }
  } catch (err) {
    mainLog.warn('[curation] mcp discovery failed:', err);
  }

  try {
    cachedSession = await client.createSession({
      systemMessage: { content: CURATION_SYSTEM_MESSAGE },
      onPermissionRequest: curationApprovalHandler,
      createSessionFsProvider: () => new InMemoryFsProvider(),
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
    } as any);
    return cachedSession;
  } catch (err) {
    mainLog.warn('[curation] createSession failed:', err);
    return null;
  }
}

function dropSession(): void {
  if (cachedSession) {
    try { void (cachedSession as any).disconnect?.(); } catch { /* ignore */ }
  }
  cachedSession = null;
}

// ---------------------------------------------------------------------------
// MCP Tool Probe (one-shot, cached per process lifetime)
// ---------------------------------------------------------------------------

async function probeWorkIQTools(): Promise<string[]> {
  if (probedTools !== null) return probedTools;

  mainLog.info('[curation] probing WorkIQ/Slack MCP tools...');
  const session = await getSession();
  if (!session) {
    mainLog.warn('[curation] cannot probe: no session');
    probedTools = [];
    return probedTools;
  }

  try {
    const response = await (session as any).sendAndWait(
      { prompt: 'List the tool names you have available from the WorkIQ MCP server and Slack MCP server. Return only a JSON array of tool name strings, no prose.' },
      SDK_TIMEOUT_MS,
    );

    const content = response?.data?.content ?? '';
    const parsed = parseJsonArray(content);
    if (Array.isArray(parsed)) {
      probedTools = parsed.filter((x: unknown) => typeof x === 'string') as string[];
      mainLog.info(`[curation] probed tools: ${probedTools.length} found`, probedTools);
    } else {
      mainLog.warn('[curation] probe returned non-array:', content.slice(0, 200));
      probedTools = [];
    }
  } catch (err) {
    mainLog.warn('[curation] probe failed:', err);
    probedTools = [];
  }

  return probedTools;
}

/** Exported for tests. */
export function _resetProbeCache(): void {
  probedTools = null;
}

/** Test-only: clear the cached session so next getSession() creates fresh. */
export function _resetSession(): void {
  cachedSession = null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface RunMorningCurationResult {
  runId: string;
  todosCreated: number;
  summary: string;
}

export async function runMorningCuration(
  options: { kickoff?: boolean } = {},
): Promise<RunMorningCurationResult> {
  const isKickoff = options.kickoff ?? isFirstRunEver();
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = isKickoff
    ? new Date(now.getTime() - KICKOFF_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    : new Date(now.getTime() - MORNING_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const runType = isKickoff ? 'kickoff' : 'manual_morning';

  // Step 1: Create run row
  const run = createCurationRun({
    run_type: runType as any,
    started_at: now.toISOString(),
    source_window_start: windowStart,
    source_window_end: windowEnd,
  });
  updateCurationRun(run.id, { status: 'running' });

  try {
    // Step 2: Probe tools (cached after first call)
    const tools = await probeWorkIQTools();

    // Step 3: Build prompt
    const existingTodos = listTodos({ status: ['open', 'in_progress', 'snoozed'] });
    const categories = listCategories();
    const goals = listGoals();
    const vips = listVipSenders();

    const prompt = buildMorningPrompt({
      windowStart,
      windowEnd,
      existingOpenTodos: existingTodos,
      categories,
      goals,
      vips,
      probedTools: tools.length > 0 ? tools : undefined,
    });

    // Step 4: Send to SDK
    const session = await getSession();
    if (!session) throw new Error('Failed to create SDK session');

    let response = await (session as any).sendAndWait({ prompt }, SDK_TIMEOUT_MS);
    let content: string = response?.data?.content ?? '';

    // Step 5: Handle empty-content + tool-requests (follow-up pattern from workiq-source)
    if (!content && response?.data?.toolRequests?.length) {
      mainLog.info('[curation] got tool requests without content, sending follow-up');
      response = await (session as any).sendAndWait(
        { prompt: 'Continue. Return the final JSON result now.' },
        SDK_TIMEOUT_MS,
      );
      content = response?.data?.content ?? '';
    }

    if (!content) {
      throw new Error('SDK returned empty content after follow-up');
    }

    // Step 6: Parse response
    const parsed = parseCurationResponse(content);

    // Step 7: Dedupe
    const candidates = parsed.items;
    const surviving = deduplicateCandidates(candidates, existingTodos);

    // Step 8: Insert todos
    let todosCreated = 0;
    for (const item of surviving) {
      createTodo({
        title: item.title.slice(0, MAX_TITLE_LEN),
        description: (item.description ?? '').slice(0, MAX_DESC_LEN) || null,
        source: 'curation',
        curation_run_id: run.id,
        priority: sanitizePriority(item.priority),
        kind: sanitizeKind(item.kind),
        category_id: item.category_id ?? null,
        goal_id: item.goal_id ?? null,
        linked_meeting_id: item.linked_meeting_id ?? null,
        evidence_uids: item.evidence_uids ?? null,
        triage_state: 'suggested',
      });
      todosCreated++;
    }

    // Step 9: Persist summary
    const summary = parsed.summary || 'Morning curation complete.';

    // Step 10: Mark run complete
    updateCurationRun(run.id, {
      status: 'complete',
      completed_at: new Date().toISOString(),
      todos_created: todosCreated,
      summary,
    });

    // Notify renderer
    sendToAllWindows('todos:changed');
    sendToAllWindows('curation:run-complete', {
      runId: run.id,
      run_type: runType,
      todosCreated,
      summary,
    });

    mainLog.info(`[curation] run ${run.id} complete: ${todosCreated} todos created`);
    return { runId: run.id, todosCreated, summary };
  } catch (err) {
    const errorMsg = describeError(err);
    mainLog.error('[curation] run failed:', errorMsg);
    updateCurationRun(run.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: errorMsg,
    });
    dropSession();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface CurationCandidate {
  kind: string;
  title: string;
  description?: string | null;
  priority: string;
  category_id?: string | null;
  goal_id?: string | null;
  linked_meeting_id?: string | null;
  evidence_uids?: string[] | null;
}

interface CurationResponse {
  summary: string;
  items: CurationCandidate[];
}

function parseCurationResponse(content: string): CurationResponse {
  // Strip markdown fences if present
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  try {
    const obj = JSON.parse(cleaned);
    if (!obj || typeof obj !== 'object') throw new Error('not an object');
    const summary = typeof obj.summary === 'string' ? obj.summary : '';
    const items = Array.isArray(obj.items) ? obj.items : [];
    return { summary, items };
  } catch (err) {
    mainLog.warn('[curation] JSON parse failed, attempting extraction:', (err as Error).message);
    // Try to find JSON in the content
    const jsonMatch = content.match(/\{[\s\S]*"items"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        const summary = typeof obj.summary === 'string' ? obj.summary : '';
        const items = Array.isArray(obj.items) ? obj.items : [];
        return { summary, items };
      } catch { /* fall through */ }
    }
    return { summary: '', items: [] };
  }
}

function parseJsonArray(content: string): unknown {
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deduplication (basic title similarity for E.2a)
// ---------------------------------------------------------------------------

export function deduplicateCandidates(
  candidates: CurationCandidate[],
  existingTodos: { title: string }[],
): CurationCandidate[] {
  const existingTitles = existingTodos.map(t => t.title.toLowerCase());
  return candidates.filter(candidate => {
    const candidateTitle = candidate.title.toLowerCase();
    for (const existing of existingTitles) {
      // Case-insensitive containment check
      if (existing.includes(candidateTitle) || candidateTitle.includes(existing)) {
        return false;
      }
      // Levenshtein distance check
      if (levenshteinDistance(candidateTitle, existing) < DEDUPE_LEVENSHTEIN_THRESHOLD) {
        return false;
      }
    }
    return true;
  });
}

/** Simple Levenshtein distance. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[b.length][a.length];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFirstRunEver(): boolean {
  const runs = listCurationRuns({ limit: 1 });
  return runs.length === 0;
}

function sanitizePriority(p: unknown): TodoPriority {
  const valid = new Set(['urgent', 'today', 'this_week', 'whenever']);
  return valid.has(p as string) ? (p as TodoPriority) : 'whenever';
}

function sanitizeKind(k: unknown): TodoKind {
  const valid = new Set(['task', 'meeting_prep', 'handoff_note']);
  return valid.has(k as string) ? (k as TodoKind) : 'task';
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const stack = err.stack ? `\n${err.stack.slice(0, 500)}` : '';
    return `${err.message}${stack}`;
  }
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}
