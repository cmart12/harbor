/**
 * Renderer-side helper that aggregates pending sandbox-block notifications
 * into "incidents" — groups of identical post-tool-shell denials so the UI
 * doesn't stack duplicate panels when an agent retries the same blocked
 * operation.
 *
 * Pre-tool / permission blocks are NEVER collapsed because each carries an
 * independent user decision (e.g. allowing one path-write is not the same as
 * allowing N). Only `source === 'post-tool-shell'` blocks aggregate, since by
 * that point the tool already failed at the OS level and the user's choices
 * are limited to "Disable & retry" (idempotent runtime flip) or "Ignore".
 */

/** Minimal shape we need; matches both the canvas-side and main-renderer
 *  SandboxBlockInfo types. */
export interface IncidentInputBlock {
  agentId: string;
  requestId: string;
  source: 'permission' | 'pre-tool' | 'post-tool-shell';
  kind: 'read' | 'write' | 'shell' | 'mcp' | 'url' | 'web-fetch';
  toolName?: string;
  target: string;
  intention?: string;
  allowedDecisions?: Array<'allow-once' | 'allow-for-session' | 'disable'>;
  layer?: string;
  personaHandle?: string;
}

export interface SandboxIncident<B extends IncidentInputBlock = IncidentInputBlock> {
  /** Stable dedup key for this incident across re-aggregations. */
  key: string;
  /** Oldest (first-seen) block in the group. Used to drive the visible UI
   *  fields (command, intention, layer, persona, etc.). */
  sample: B;
  /** All requestIds in this incident, in insertion order. */
  requestIds: string[];
  /** Convenience — equal to `requestIds.length`. */
  count: number;
}

/**
 * Collapse whitespace so trivial formatting differences in identical commands
 * still match.  We intentionally do NOT lowercase: shell command case is
 * meaningful (`RM` vs `rm`).
 */
function normalizeTarget(target: string): string {
  return target.trim().replace(/\s+/g, ' ');
}

function dedupKeyForBlock(block: IncidentInputBlock): string {
  return [
    block.source,
    block.kind,
    block.toolName ?? '',
    block.layer ?? '',
    normalizeTarget(block.target),
  ].join('\u0000');
}

/**
 * Aggregate the given pending blocks into incidents.
 *
 *  - Post-tool-shell blocks with identical `(source, kind, toolName, layer,
 *    normalized target)` are collapsed into a single incident with
 *    `requestIds` ordered by insertion.
 *  - Pre-tool and permission blocks always produce one incident per block —
 *    each represents an independent user decision and must NOT be silently
 *    fanned out as a bulk approval.
 *
 * The input order is preserved for distinct incidents so the UI renders the
 * oldest-incident-first.
 */
export function aggregateSandboxBlocks<B extends IncidentInputBlock>(
  blocks: Iterable<B>,
): Array<SandboxIncident<B>> {
  const incidents: Array<SandboxIncident<B>> = [];
  const indexByKey = new Map<string, number>();

  for (const block of blocks) {
    if (block.source !== 'post-tool-shell') {
      // Each pre-tool / permission block stands alone — using its own
      // requestId as the key guarantees uniqueness even on re-aggregation.
      incidents.push({
        key: `unique:${block.requestId}`,
        sample: block,
        requestIds: [block.requestId],
        count: 1,
      });
      continue;
    }

    const key = dedupKeyForBlock(block);
    const existingIdx = indexByKey.get(key);
    if (existingIdx === undefined) {
      indexByKey.set(key, incidents.length);
      incidents.push({
        key,
        sample: block,
        requestIds: [block.requestId],
        count: 1,
      });
    } else {
      const existing = incidents[existingIdx];
      existing.requestIds.push(block.requestId);
      existing.count = existing.requestIds.length;
    }
  }

  return incidents;
}

export type SandboxResolveDecision = 'allow-once' | 'allow-for-session' | 'disable';

/**
 * Produce the staged fan-out plan for resolving an incident.  The first
 * requestId carries the user's actual decision; the remainder dismiss with
 * `'allow-once'`.
 *
 * Why staged:
 *  - `'disable'` triggers `disableSandboxForSession`, which flips runtime
 *    state and sends a retry prompt.  Calling it in parallel for N blocks can
 *    race the state flip and emit multiple retry prompts.  By only sending
 *    `'disable'` once we get exactly one runtime flip + one retry.
 *  - `'allow-once'` on a post-tool-shell block is a no-op (the tool already
 *    failed), so resolving the remaining broker callbacks with `'allow-once'`
 *    just dismisses them.
 *  - For a single-block incident this collapses to `[(reqId, decision)]`.
 */
export function planIncidentResolve(
  incident: Pick<SandboxIncident, 'requestIds'>,
  decision: SandboxResolveDecision,
): Array<{ requestId: string; decision: SandboxResolveDecision }> {
  if (incident.requestIds.length === 0) return [];
  const [first, ...rest] = incident.requestIds;
  const plan: Array<{ requestId: string; decision: SandboxResolveDecision }> = [
    { requestId: first, decision },
  ];
  for (const reqId of rest) {
    plan.push({ requestId: reqId, decision: 'allow-once' });
  }
  return plan;
}

/**
 * Truncate a command preview for display in narrow chrome (e.g. worker
 * tiles). Falls back to the original string when within the limit.  Caller
 * should still set the full string as a `title` attribute for hover.
 */
export function truncateCommandPreview(target: string, max = 40): string {
  const t = target.trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + '…';
}
