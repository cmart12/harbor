/**
 * Pure helpers used by the list components. Mirrors the equivalent functions
 * in legacy app.ts so the React migration can drop the duplicates from app.ts
 * in Phase 6.
 */

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export interface DueInfo {
  text: string;
  overdue: boolean;
}

export function formatDueDate(due_at_utc: string | null, due_at: string | null): DueInfo {
  if (!due_at_utc) {
    return due_at ? { text: due_at, overdue: false } : { text: '', overdue: false };
  }

  const due = new Date(due_at_utc);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const overdue = diffMs < 0;

  if (overdue) {
    const absDays = Math.abs(diffDays);
    if (absDays === 0) return { text: 'due today', overdue: true };
    if (absDays === 1) return { text: '1d overdue', overdue: true };
    return { text: `${absDays}d overdue`, overdue: true };
  }

  if (diffDays === 0) return { text: 'due today', overdue: false };
  if (diffDays === 1) return { text: 'tomorrow', overdue: false };
  if (diffDays <= 7) return { text: `in ${diffDays}d`, overdue: false };

  return {
    text: due.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    overdue: false,
  };
}

export function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : filePath;
}

export function humanizeToolName(toolName: string, args?: Record<string, unknown>): string {
  const fileName = typeof args?.path === 'string' ? basename(args.path) : '';

  if (toolName === 'report_intent' && typeof args?.intent === 'string') {
    return args.intent.slice(0, 80);
  }
  if (toolName === 'bash' && typeof args?.command === 'string') {
    const cmd = args.command;
    return cmd.length > 80 ? cmd.slice(0, 77) + '…' : cmd;
  }
  if (toolName === 'edit' && fileName) return `Editing ${fileName}`;
  if (toolName === 'create' && fileName) return `Creating ${fileName}`;
  if (toolName === 'view' && fileName) return `Reading ${fileName}`;

  const map: Record<string, string> = {
    bash: 'Running command',
    edit: 'Editing file',
    create: 'Creating file',
    view: 'Reading file',
    grep: 'Searching code',
    glob: 'Finding files',
    web_fetch: 'Fetching web page',
    web_search: 'Searching the web',
    sql: 'Running query',
  };
  return map[toolName] || toolName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export interface ApprovalDescriptor {
  permissionKind: string;
  intention?: string;
  path?: string;
}

export interface ApprovalDescription {
  label: string;
  detail: string;
}

export function describeApproval(approval: ApprovalDescriptor): ApprovalDescription {
  let label: string;
  const kind = approval.permissionKind;
  if (kind.includes('file') || kind.includes('write')) label = 'Write to files';
  else if (kind.includes('bash') || kind.includes('exec') || kind.includes('command')) label = 'Execute a command';
  else if (kind.includes('read')) label = 'Read files';
  else label = kind.replace(/_/g, ' ');

  let detail = '';
  if (approval.path) {
    const parts = approval.path.replace(/\\/g, '/').split('/').filter(Boolean);
    detail = parts.length > 3 ? '…/' + parts.slice(-3).join('/') : approval.path;
  } else if (approval.intention) {
    detail = approval.intention;
  }

  return { label, detail };
}
