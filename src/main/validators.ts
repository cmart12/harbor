import type { CustomMcpServer, CliToolDefinition } from './config';
import { DEFAULT_SANDBOX_POLICY, type SandboxPolicy } from '../shared/ipc-contract';

export function validateMcpServers(servers: unknown): CustomMcpServer[] | { error: string } {
  if (!Array.isArray(servers)) return { error: 'invalid payload' };

  const validated: CustomMcpServer[] = [];
  const seen = new Set<string>();

  for (const s of servers) {
    if (!s || typeof s !== 'object') continue;
    const raw = s as Record<string, unknown>;

    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const type = typeof raw.type === 'string' && ['stdio', 'http', 'sse'].includes(raw.type) ? raw.type as 'stdio' | 'http' | 'sse' : 'stdio';
    const command = typeof raw.command === 'string' ? raw.command.trim() : undefined;
    const args = Array.isArray(raw.args) ? raw.args.filter((a: unknown) => typeof a === 'string') as string[] : [];
    const url = typeof raw.url === 'string' ? raw.url.trim() : undefined;
    const tools = Array.isArray(raw.tools) ? raw.tools.filter((t: unknown) => typeof t === 'string') as string[] : ['*'];

    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    if (type === 'stdio' && !command) continue;
    if ((type === 'http' || type === 'sse') && !url) continue;

    validated.push({ name, type, command, args, url, tools });
  }

  return validated;
}

export function validateCliTools(tools: unknown): CliToolDefinition[] | { error: string } {
  if (!Array.isArray(tools)) return { error: 'invalid payload' };

  const validated: CliToolDefinition[] = [];
  const seen = new Set<string>();

  for (const t of tools) {
    if (!t || typeof t !== 'object') continue;
    const raw = t as Record<string, unknown>;

    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const description = typeof raw.description === 'string' ? raw.description.trim().slice(0, 500) : '';

    if (!name || !description) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    validated.push({ name, description });
  }

  return validated;
}

/**
 * Normalize a string array of paths/identifiers: strip whitespace, drop empties,
 * cap length to MAX_ITEMS to prevent unbounded persistence.
 */
const MAX_PATH_LIST_ITEMS = 64;
function sanitizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_PATH_LIST_ITEMS) break;
  }
  return out;
}

/**
 * Validate and normalize a SandboxPolicy. Unknown fields are dropped; missing
 * fields fall back to DEFAULT_SANDBOX_POLICY. Returns null on non-object input
 * (callers can decide between "use default" and "reject").
 */
export function validateSandboxPolicy(raw: unknown): SandboxPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    scopeToIntentFolder: typeof r.scopeToIntentFolder === 'boolean'
      ? r.scopeToIntentFolder
      : DEFAULT_SANDBOX_POLICY.scopeToIntentFolder,
    extraReadwritePaths: sanitizeStringList(r.extraReadwritePaths),
    extraReadonlyPaths: sanitizeStringList(r.extraReadonlyPaths),
    extraDeniedPaths: sanitizeStringList(r.extraDeniedPaths),
    allowMcpServers: typeof r.allowMcpServers === 'boolean'
      ? r.allowMcpServers
      : DEFAULT_SANDBOX_POLICY.allowMcpServers,
    allowWebFetch: typeof r.allowWebFetch === 'boolean'
      ? r.allowWebFetch
      : DEFAULT_SANDBOX_POLICY.allowWebFetch,
    allowOutbound: typeof r.allowOutbound === 'boolean'
      ? r.allowOutbound
      : DEFAULT_SANDBOX_POLICY.allowOutbound,
    allowLocalNetwork: typeof r.allowLocalNetwork === 'boolean'
      ? r.allowLocalNetwork
      : DEFAULT_SANDBOX_POLICY.allowLocalNetwork,
    enforcementMode: r.enforcementMode === 'mxc-only' ? 'mxc-only' : 'both',
  };
}
