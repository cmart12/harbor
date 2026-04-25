import type { CustomMcpServer, CliToolDefinition } from './config';

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
