/**
 * Permission handler for curation SDK sessions (Phase E.2a).
 *
 * Allowlist:
 *  - kind: 'mcp' AND serverName in ['workiq', 'slack'] -> approve
 *  - kind: 'extension-management' AND extensionName in ['workiq', 'slack'] -> approve
 *  - kind: 'extension-permission-access' AND extensionName in ['workiq', 'slack'] -> approve
 *  - kind: 'read' (harmless model introspection) -> approve
 *
 * Everything else (shell, write, url, memory, custom-tool, hook, and
 * any MCP/extension not in the allowed set) is rejected so the curation
 * prompt cannot trigger arbitrary side effects.
 */

const ALLOWED_SERVERS = new Set(['workiq', 'slack']);

export async function curationApprovalHandler(
  request: unknown,
): Promise<{ kind: 'approve-once' | 'reject' }> {
  const req = request as {
    kind?: string;
    serverName?: string;
    extensionName?: string;
  };

  switch (req.kind) {
    case 'mcp':
      return ALLOWED_SERVERS.has(req.serverName ?? '')
        ? { kind: 'approve-once' as const }
        : { kind: 'reject' as const };
    case 'extension-management':
    case 'extension-permission-access':
      return ALLOWED_SERVERS.has(req.extensionName ?? '')
        ? { kind: 'approve-once' as const }
        : { kind: 'reject' as const };
    case 'read':
      return { kind: 'approve-once' as const };
    default:
      return { kind: 'reject' as const };
  }
}
