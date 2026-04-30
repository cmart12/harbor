import * as path from 'path';
import * as fs from 'fs';
import { CopilotClient, CopilotSession } from '@github/copilot-sdk';
import { getConfigValue } from './config';
import { resolveCopilotCliPath } from './session';
import { RecurrenceResult, RecallMatch, Space } from '../shared/types';
import type { SandboxPolicy } from '../shared/ipc-contract';

/**
 * Per-agent sandbox config dirs that the SDK can pass to `createSession`/
 * `resumeSession`.  We pre-materialize both `on` and `off` so the
 * "Disable sandbox for session" bubble-up flow can `resumeSession` into the
 * off-dir cleanly without rewriting files mid-flight.
 */
export interface SandboxConfigDirs {
  onDir: string;
  offDir: string;
}

/**
 * Build the runtime-format sandbox config object for a given policy and space
 * working directory. Mirrors the shape consumed by `copilot-agent-runtime`'s
 * `UserSettings.sandbox` (see docs/mxc-sandbox-schema.md).
 */
function materializeRuntimeConfig(
  enabled: boolean,
  intentWorkingDir: string,
  policy: SandboxPolicy,
): Record<string, unknown> {
  const readwritePaths: string[] = [];
  if (policy.scopeToSpaceFolder) readwritePaths.push(intentWorkingDir);
  for (const p of policy.extraReadwritePaths) {
    if (!readwritePaths.includes(p)) readwritePaths.push(p);
  }

  return {
    sandbox: {
      enabled,
      filesystem: {
        readwritePaths,
        readonlyPaths: [...policy.extraReadonlyPaths],
        deniedPaths: [...policy.extraDeniedPaths],
        clearPolicyOnExit: true,
      },
      network: {
        allowOutbound: policy.allowOutbound,
        allowLocalNetwork: policy.allowLocalNetwork,
      },
    },
  };
}

function getSandboxRoot(): string {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'sandbox-config');
}

/**
 * Materialize on/ and off/ sandbox config dirs for a single agent. Both dirs
 * receive `config.json` files that the runtime reads as its `COPILOT_HOME`.
 *
 * Windows-only — returns null on other platforms (mxc is Windows-only today).
 *
 * Caller passes `policy` already resolved via `resolveSandboxPolicy(persona)`.
 */
export function buildSandboxConfigs(
  agentId: string,
  intentWorkingDir: string,
  policy: SandboxPolicy,
): SandboxConfigDirs | null {
  if (process.platform !== 'win32') return null;

  const root = getSandboxRoot();
  const agentRoot = path.join(root, agentId);
  const onDir = path.join(agentRoot, 'on');
  const offDir = path.join(agentRoot, 'off');

  fs.mkdirSync(onDir, { recursive: true });
  fs.mkdirSync(offDir, { recursive: true });

  const onConfig = materializeRuntimeConfig(true, intentWorkingDir, policy);
  const offConfig = materializeRuntimeConfig(false, intentWorkingDir, policy);

  fs.writeFileSync(path.join(onDir, 'config.json'), JSON.stringify(onConfig, null, 2));
  fs.writeFileSync(path.join(offDir, 'config.json'), JSON.stringify(offConfig, null, 2));

  // Surfaces the exact paths and policy applied so users can verify which
  // config the runtime is loading. Matches the "Open config preview" button
  // in the persona editor — both pull from materializeRuntimeConfig().
  console.log(
    `[sandbox] Materialized configs for agent ${agentId}:\n` +
    `  on:  ${path.join(onDir, 'config.json')}\n` +
    `  off: ${path.join(offDir, 'config.json')}\n` +
    `  policy: enforcementMode=${policy.enforcementMode} scopeToSpaceFolder=${policy.scopeToSpaceFolder} ` +
    `allowMcpServers=${policy.allowMcpServers} allowWebFetch=${policy.allowWebFetch} ` +
    `allowOutbound=${policy.allowOutbound} allowLocalNetwork=${policy.allowLocalNetwork}\n` +
    `  on-config: ${JSON.stringify(onConfig)}`,
  );

  return { onDir, offDir };
}

/**
 * Materialize a "preview" config.json for a sandbox policy without writing
 * any per-agent state. The space folder is left as a placeholder so the
 * user can see where it'd be substituted at real agent launch time.
 *
 * Returns the JSON object — callers (e.g., the IPC handler that opens the
 * preview in the default text editor) decide where to write it.
 */
export function previewSandboxConfig(policy: SandboxPolicy): Record<string, unknown> {
  return materializeRuntimeConfig(true, '<space folder — replaced at agent launch>', policy);
}

/**
 * Remove the per-agent sandbox config directory (both on/ and off/). Safe to
 * call on a directory that doesn't exist.
 */
export function cleanupSandboxConfigs(agentId: string): void {
  if (!agentId) return;
  const agentRoot = path.join(getSandboxRoot(), agentId);
  try {
    fs.rmSync(agentRoot, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[ai] Failed to cleanup sandbox config for agent ${agentId}:`, err);
  }
}

export interface ParsedSpace {
  description: string;
  client: string | null;
  due_at: string | null;
  due_at_utc: string | null;
}

let client: CopilotClient | null = null;
let parseSession: CopilotSession | null = null;
let recurrenceSession: CopilotSession | null = null;
let recallSession: CopilotSession | null = null;

const PARSE_SYSTEM_MESSAGE = `You are an space parser. Given user input that may range from a short phrase to a long voice transcript (covering initiatives, goals, overviews, etc.), extract structured fields.
The user's current local time will be provided for resolving relative dates.

Return ONLY a JSON object with these fields (no markdown, no explanation):
- "title": a concise, action-oriented title (max ~10 words) that captures the core space
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

const RECURRENCE_SYSTEM_MESSAGE = `You evaluate whether a completed space should recur.
Based on the space's language, decide if this is a recurring task or a one-off.

Return ONLY a JSON object (no markdown, no explanation):
{
  "should_recur": true or false,
  "reasoning": "brief explanation",
  "next_due": "human-readable next date, or null",
  "next_due_utc": "ISO 8601 UTC next date, or null"
}

Examples of recurring spaces:
- "send weekly status update by Monday" → recur, next Monday
- "review PRs before standup every day" → recur, tomorrow
- "file quarterly taxes by April 15" → recur, July 15

Examples of one-off spaces:
- "finish the presentation by Friday" → don't recur
- "buy birthday gift for mom" → don't recur`;

const RECALL_SYSTEM_MESSAGE = `You find semantically similar spaces. Given a new space and a list of past spaces, identify the most relevant past space if any.

Return ONLY a JSON object (no markdown, no explanation):
{
  "match_index": the 0-based index of the most similar past space, or -1 if none are similar enough,
  "confidence": a number from 0.0 to 1.0 indicating similarity,
  "reasoning": "brief explanation"
}

Only match spaces that are genuinely about the same task or topic. Don't match on superficial word overlap.
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
    const opts: Record<string, unknown> = { useStdio: false };
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

export async function parseSpaceWithAI(rawText: string): Promise<ParsedSpace> {
  const session = await getParseSession();
  if (!session) {
    console.warn('[copilot-sdk] Parse session not ready, returning raw text');
    return { description: rawText, client: null, due_at: null, due_at_utc: null };
  }

  try {
    const response = await session.sendAndWait({
      prompt: `${getLocalTimeContext()}\n\nParse this space:\nInput: "${rawText}"`,
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
  type: 'space' | 'query';
  query_answer?: string;
}

/** Classify whether user input is a new space or a question about their spaces/history */
export async function classifyInput(text: string, recentSpaces: { description: string; status: string; due_at: string | null; completed_at: string | null }[]): Promise<InputClassification> {
  const session = await getParseSession();
  if (!session) return { type: 'space' };

  const intentList = recentSpaces.slice(0, 15).map((i, idx) =>
    `${idx}. "${i.description}" [${i.status}]${i.due_at ? ` due: ${i.due_at}` : ''}${i.completed_at ? ` completed: ${i.completed_at}` : ''}`
  ).join('\n');

  try {
    const response = await session.sendAndWait({
      prompt: `${getLocalTimeContext()}

Classify this user input. Is it:
A) A new space/task to capture (action item, to-do, reminder)
B) A question or query about their existing spaces, history, or schedule

User's current spaces:
${intentList || '(none)'}

User input: "${text}"

Return ONLY JSON:
{"type": "space" or "query", "query_answer": "brief answer if type=query, otherwise null"}`,
    }, 15000);

    const content = response?.data?.content ?? '';
    const parsed = extractJson(content);
    if (!parsed) return { type: 'space' };

    return {
      type: parsed.type === 'query' ? 'query' : 'space',
      query_answer: parsed.query_answer || undefined,
    };
  } catch (err) {
    console.error('[copilot-sdk] Classify failed:', err);
    return { type: 'space' };
  }
}

export async function evaluateRecurrence(space: {
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

The user completed this space:
  Original text: "${space.raw_text || space.description}"
  Refined description: "${space.description}"
  Due date: "${space.due_at || 'none'}" (${space.due_at_utc || 'no UTC date'})
  Completed at: "${space.completed_at}"

Should this space recur? If yes, when is the next due date?`,
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
      if (new Date(result.next_due_utc) <= new Date(space.completed_at)) {
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

export async function findSimilarSpace(newDescription: string, candidates: Space[]): Promise<RecallMatch | null> {
  if (candidates.length === 0) return null;
  const session = await getRecallSession();
  if (!session) return null;

  try {
    const candidateList = candidates.map((c, i) =>
      `${i}. "${c.description}" (status: ${c.status}${c.completed_at ? ', completed: ' + c.completed_at : ''})`
    ).join('\n');

    const response = await session.sendAndWait({
      prompt: `New space: "${newDescription}"

Past spaces:
${candidateList}

Find the most semantically similar past space, if any.`,
    }, 30000);

    const content = response?.data?.content ?? '';
    const parsed = extractJson(content);
    if (!parsed || parsed.match_index === -1 || parsed.confidence < 0.5) return null;

    const idx = parsed.match_index;
    if (idx < 0 || idx >= candidates.length) return null;

    const matched = candidates[idx];
    return {
      space_id: matched.id,
      description: matched.description,
      completed_at: matched.completed_at,
      confidence: parsed.confidence,
    };
  } catch (err) {
    console.error('[copilot-sdk] Recall search failed:', err);
    return null;
  }
}
