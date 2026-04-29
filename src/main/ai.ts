import * as path from 'path';
import * as fs from 'fs';
import { CopilotClient, CopilotSession } from '@github/copilot-sdk';
import { getConfigValue } from './config';
import { resolveCopilotCliPath } from './session';
import { RecurrenceResult, RecallMatch, Intent } from '../shared/types';

/**
 * Returns the path to a sandbox-specific config directory that enables
 * runtime-level sandboxing (mxc AppContainer isolation).
 * The config scopes filesystem access to the intent's working directory:
 * - readwritePaths: only the intent folder (cwd is added by runtime automatically)
 * - deniedPaths: the workspace root (prevents escaping to sibling intents)
 * Windows-only — returns undefined on other platforms.
 */
export function getSandboxConfigDir(intentWorkingDir: string, workspaceRoot: string): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const { app } = require('electron');
  // Use a hash of the intent dir to create per-intent sandbox configs
  const crypto = require('crypto');
  const dirHash = crypto.createHash('md5').update(intentWorkingDir).digest('hex').slice(0, 8);
  const dir = path.join(app.getPath('userData'), 'sandbox-config', dirHash);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Write sandbox config scoped to this intent's directory.
  // The mxc AppContainer only grants read-write to explicitly listed paths + cwd,
  // so we don't need deniedPaths — the agent simply won't have write access outside
  // the intent folder. The workspace root is added as read-only so the agent can
  // read sibling files but not modify them.
  const sandboxConfig = {
    sandbox: {
      enabled: true,
      filesystem: {
        readwritePaths: [intentWorkingDir],
        readonlyPaths: [workspaceRoot],
      },
    },
  };

  const cfg = path.join(dir, 'config.json');
  // Always rewrite to ensure paths are current
  fs.writeFileSync(cfg, JSON.stringify(sandboxConfig, null, 2));
  return dir;
}

export interface ParsedIntent {
  description: string;
  client: string | null;
  due_at: string | null;
  due_at_utc: string | null;
}

let client: CopilotClient | null = null;
let parseSession: CopilotSession | null = null;
let recurrenceSession: CopilotSession | null = null;
let recallSession: CopilotSession | null = null;

const PARSE_SYSTEM_MESSAGE = `You are an intent parser. Given user input that may range from a short phrase to a long voice transcript (covering initiatives, goals, overviews, etc.), extract structured fields.
The user's current local time will be provided for resolving relative dates.

Return ONLY a JSON object with these fields (no markdown, no explanation):
- "title": a concise, action-oriented title (max ~10 words) that captures the core intent
- "client": the client/company name if mentioned, otherwise null
- "due_at": a human-readable due date/time if mentioned, otherwise null
- "due_at_utc": the due date as ISO 8601 UTC (e.g. "2026-04-21T17:00:00Z") if a date was mentioned, otherwise null

Examples:
Input: "make a powerpoint deck for Acme by Friday"
(Current local time: 2026-04-16T10:00:00-07:00, Wednesday)
Output: {"title":"Create PowerPoint deck for Acme","client":"Acme","due_at":"Friday","due_at_utc":"2026-04-18T23:59:00Z"}

Input: "I've been thinking about the roadmap for next quarter. We need to align with the Contoso team on their API changes, finalize the migration plan, and get the security audit done before end of month. The main priority is making sure we don't break existing integrations."
Output: {"title":"Plan Q3 roadmap and Contoso API alignment","client":"Contoso","due_at":"End of month","due_at_utc":"2026-04-30T23:59:00Z"}

Input: "review the PR"
Output: {"title":"Review the PR","client":null,"due_at":null,"due_at_utc":null}`;

const RECURRENCE_SYSTEM_MESSAGE = `You evaluate whether a completed intent should recur.
Based on the intent's language, decide if this is a recurring task or a one-off.

Return ONLY a JSON object (no markdown, no explanation):
{
  "should_recur": true or false,
  "reasoning": "brief explanation",
  "next_due": "human-readable next date, or null",
  "next_due_utc": "ISO 8601 UTC next date, or null"
}

Examples of recurring intents:
- "send weekly status update by Monday" → recur, next Monday
- "review PRs before standup every day" → recur, tomorrow
- "file quarterly taxes by April 15" → recur, July 15

Examples of one-off intents:
- "finish the presentation by Friday" → don't recur
- "buy birthday gift for mom" → don't recur`;

const RECALL_SYSTEM_MESSAGE = `You find semantically similar intents. Given a new intent and a list of past intents, identify the most relevant past intent if any.

Return ONLY a JSON object (no markdown, no explanation):
{
  "match_index": the 0-based index of the most similar past intent, or -1 if none are similar enough,
  "confidence": a number from 0.0 to 1.0 indicating similarity,
  "reasoning": "brief explanation"
}

Only match intents that are genuinely about the same task or topic. Don't match on superficial word overlap.
A confidence below 0.5 means no meaningful match.`;

async function createSession(systemMessage: string): Promise<CopilotSession | null> {
  if (!client) return null;
  try {
    const model = getConfigValue('model') || undefined;
    return await client.createSession({
      systemMessage: { content: systemMessage },
      model,
      onPermissionRequest: async () => ({ kind: 'reject' as const }),
    });
  } catch (err) {
    console.error('[copilot-sdk] Failed to create session:', err);
    return null;
  }
}

async function getParseSession(): Promise<CopilotSession | null> {
  if (!parseSession) parseSession = await createSession(PARSE_SYSTEM_MESSAGE);
  return parseSession;
}

async function getRecurrenceSession(): Promise<CopilotSession | null> {
  if (!recurrenceSession) recurrenceSession = await createSession(RECURRENCE_SYSTEM_MESSAGE);
  return recurrenceSession;
}

async function getRecallSession(): Promise<CopilotSession | null> {
  if (!recallSession) recallSession = await createSession(RECALL_SYSTEM_MESSAGE);
  return recallSession;
}

export async function initCopilot(): Promise<void> {
  try {
    const cliPath = resolveCopilotCliPath();
    const opts: Record<string, unknown> = {
      useStdio: false,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    };
    if (cliPath) {
      opts.cliPath = cliPath;
      console.log(`[copilot-sdk] Using local CLI: ${cliPath}`);
    } else {
      console.warn('[copilot-sdk] Local CLI not found, using bundled CLI (sessions may not be resumable from terminal)');
    }
    client = new CopilotClient(opts as any);
    await client.start();
    // Eagerly init the parse session (most commonly used)
    await getParseSession();
    console.log('[copilot-sdk] Client started, parse session created');
  } catch (err) {
    console.error('[copilot-sdk] Failed to initialize:', err);
    client = null;
  }
}

export function getCopilotClient(): CopilotClient | null {
  return client;
}

/** Shut down and re-initialize the Copilot SDK client (e.g. after CLI path change). */
export async function reinitCopilot(): Promise<void> {
  await shutdownCopilot();
  await initCopilot();
}

export async function setAIModel(model: string): Promise<void> {
  // Update all active sessions
  const sessions = [parseSession, recurrenceSession, recallSession];
  for (const s of sessions) {
    if (s) {
      try { await s.setModel(model); } catch { /* ignore */ }
    }
  }
  console.log(`[copilot-sdk] Model changed to: ${model}`);
}

export async function listAvailableModels(): Promise<{ id: string; name?: string }[]> {
  if (!client) return [];
  try {
    const models = await client.listModels();
    return models.map(m => ({ id: m.id, name: m.name }));
  } catch {
    return [];
  }
}

export async function shutdownCopilot(): Promise<void> {
  try {
    for (const s of [parseSession, recurrenceSession, recallSession]) {
      if (s) await s.disconnect();
    }
    parseSession = recurrenceSession = recallSession = null;
    if (client) {
      await client.stop();
      client = null;
    }
    console.log('[copilot-sdk] Shut down');
  } catch (err) {
    console.error('[copilot-sdk] Error during shutdown:', err);
  }
}

function extractJson(text: string): any | null {
  const match = text.trim().match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function isValidIso8601(s: string | null | undefined): boolean {
  if (!s) return false;
  const d = new Date(s);
  return !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(s);
}

function getLocalTimeContext(): string {
  const now = new Date();
  const local = now.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
  return `Current local time: ${now.toISOString().replace('Z', '')}${getTimezoneOffsetString()} (${local})\nCurrent UTC: ${now.toISOString()}`;
}

function getTimezoneOffsetString(): string {
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const hrs = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const mins = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${sign}${hrs}:${mins}`;
}

export async function parseIntentWithAI(rawText: string): Promise<ParsedIntent> {
  const session = await getParseSession();
  if (!session) {
    console.warn('[copilot-sdk] Parse session not ready, returning raw text');
    return { description: rawText, client: null, due_at: null, due_at_utc: null };
  }

  try {
    const response = await session.sendAndWait({
      prompt: `${getLocalTimeContext()}\n\nParse this intent:\nInput: "${rawText}"`,
    }, 30000);

    const content = response?.data?.content ?? '';
    const parsed = extractJson(content);
    if (!parsed) {
      console.error('[copilot-sdk] Response was not JSON:', content);
      return { description: rawText, client: null, due_at: null, due_at_utc: null };
    }

    const due_at_utc = isValidIso8601(parsed.due_at_utc) ? parsed.due_at_utc : null;

    return {
      description: parsed.title || parsed.description || rawText,
      client: parsed.client || null,
      due_at: parsed.due_at || null,
      due_at_utc,
    };
  } catch (err) {
    console.error('[copilot-sdk] Parse failed:', err);
    return { description: rawText, client: null, due_at: null, due_at_utc: null };
  }
}

/** Resolve a natural language date to due_at + due_at_utc */
export async function resolveDateWithAI(dateText: string): Promise<{ due_at: string; due_at_utc: string | null }> {
  const session = await getParseSession();
  if (!session) {
    return { due_at: dateText, due_at_utc: null };
  }

  try {
    const response = await session.sendAndWait({
      prompt: `${getLocalTimeContext()}

Resolve this date/time to a specific date. Return ONLY JSON:
{"due_at": "human readable date", "due_at_utc": "ISO 8601 UTC"}

Input: "${dateText}"`,
    }, 15000);

    const content = response?.data?.content ?? '';
    const parsed = extractJson(content);
    if (!parsed) return { due_at: dateText, due_at_utc: null };

    return {
      due_at: parsed.due_at || dateText,
      due_at_utc: isValidIso8601(parsed.due_at_utc) ? parsed.due_at_utc : null,
    };
  } catch (err) {
    console.error('[copilot-sdk] Date resolve failed:', err);
    return { due_at: dateText, due_at_utc: null };
  }
}

export interface InputClassification {
  type: 'intent' | 'query';
  query_answer?: string;
}

/** Classify whether user input is a new intent or a question about their intents/history */
export async function classifyInput(text: string, recentIntents: { description: string; status: string; due_at: string | null; completed_at: string | null }[]): Promise<InputClassification> {
  const session = await getParseSession();
  if (!session) return { type: 'intent' };

  const intentList = recentIntents.slice(0, 15).map((i, idx) =>
    `${idx}. "${i.description}" [${i.status}]${i.due_at ? ` due: ${i.due_at}` : ''}${i.completed_at ? ` completed: ${i.completed_at}` : ''}`
  ).join('\n');

  try {
    const response = await session.sendAndWait({
      prompt: `${getLocalTimeContext()}

Classify this user input. Is it:
A) A new intent/task to capture (action item, to-do, reminder)
B) A question or query about their existing intents, history, or schedule

User's current intents:
${intentList || '(none)'}

User input: "${text}"

Return ONLY JSON:
{"type": "intent" or "query", "query_answer": "brief answer if type=query, otherwise null"}`,
    }, 15000);

    const content = response?.data?.content ?? '';
    const parsed = extractJson(content);
    if (!parsed) return { type: 'intent' };

    return {
      type: parsed.type === 'query' ? 'query' : 'intent',
      query_answer: parsed.query_answer || undefined,
    };
  } catch (err) {
    console.error('[copilot-sdk] Classify failed:', err);
    return { type: 'intent' };
  }
}

export async function evaluateRecurrence(intent: {
  raw_text: string | null;
  description: string;
  due_at: string | null;
  due_at_utc: string | null;
  completed_at: string;
}): Promise<RecurrenceResult> {
  const session = await getRecurrenceSession();
  const noRecur: RecurrenceResult = { should_recur: false, reasoning: 'Session not available', next_due: null, next_due_utc: null };
  if (!session) return noRecur;

  try {
    const response = await session.sendAndWait({
      prompt: `${getLocalTimeContext()}

The user completed this intent:
  Original text: "${intent.raw_text || intent.description}"
  Refined description: "${intent.description}"
  Due date: "${intent.due_at || 'none'}" (${intent.due_at_utc || 'no UTC date'})
  Completed at: "${intent.completed_at}"

Should this intent recur? If yes, when is the next due date?`,
    }, 30000);

    const content = response?.data?.content ?? '';
    const parsed = extractJson(content);
    if (!parsed) {
      console.error('[copilot-sdk] Recurrence response was not JSON:', content);
      return noRecur;
    }

    const result: RecurrenceResult = {
      should_recur: !!parsed.should_recur,
      reasoning: parsed.reasoning || '',
      next_due: parsed.next_due || null,
      next_due_utc: isValidIso8601(parsed.next_due_utc) ? parsed.next_due_utc : null,
    };

    // Sanity: next due must be after completion
    if (result.should_recur && result.next_due_utc) {
      if (new Date(result.next_due_utc) <= new Date(intent.completed_at)) {
        console.warn('[copilot-sdk] Recurrence next_due_utc is not after completed_at, discarding');
        result.next_due_utc = null;
      }
    }

    // If should recur but no valid UTC date, keep the human-readable date but clear UTC
    return result;
  } catch (err) {
    console.error('[copilot-sdk] Recurrence eval failed:', err);
    return noRecur;
  }
}

export async function findSimilarIntent(newDescription: string, candidates: Intent[]): Promise<RecallMatch | null> {
  if (candidates.length === 0) return null;
  const session = await getRecallSession();
  if (!session) return null;

  try {
    const candidateList = candidates.map((c, i) =>
      `${i}. "${c.description}" (status: ${c.status}${c.completed_at ? ', completed: ' + c.completed_at : ''})`
    ).join('\n');

    const response = await session.sendAndWait({
      prompt: `New intent: "${newDescription}"

Past intents:
${candidateList}

Find the most semantically similar past intent, if any.`,
    }, 30000);

    const content = response?.data?.content ?? '';
    const parsed = extractJson(content);
    if (!parsed || parsed.match_index === -1 || parsed.confidence < 0.5) return null;

    const idx = parsed.match_index;
    if (idx < 0 || idx >= candidates.length) return null;

    const matched = candidates[idx];
    return {
      intent_id: matched.id,
      description: matched.description,
      completed_at: matched.completed_at,
      confidence: parsed.confidence,
    };
  } catch (err) {
    console.error('[copilot-sdk] Recall search failed:', err);
    return null;
  }
}
