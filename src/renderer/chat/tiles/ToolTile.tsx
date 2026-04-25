import React, { useState } from 'react';

interface ToolTileProps {
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  completed: boolean;
  success?: boolean;
}

function friendlyPath(p: string): { name: string; dir: string } {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  const name = parts.pop() || p;
  const dir = parts.length > 1 ? parts.slice(-2).join('/') : parts.join('/');
  return { name, dir };
}

function getToolCategory(name: string): 'bash' | 'file_edit' | 'file_read' | 'generic' {
  const n = name.toLowerCase();
  if (n === 'bash' || n === 'execute_command' || n === 'shell' || n === 'run_command') return 'bash';
  if (n === 'file_edit' || n === 'edit_file' || n === 'write_file' || n === 'create_file' || n === 'str_replace_editor' || n.includes('write') || n.includes('edit') || n.includes('create')) return 'file_edit';
  if (n === 'file_read' || n === 'read_file' || n === 'view_file' || n.includes('read')) return 'file_read';
  return 'generic';
}

function formatToolLabel(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function extractCommand(args: Record<string, unknown>): string {
  return String(args.command || args.cmd || args.script || '');
}

function extractPath(args: Record<string, unknown>): string {
  return String(args.path || args.file || args.file_path || args.filename || '');
}

function countDiffStats(result: string): { added: number; removed: number } | null {
  if (!result) return null;
  let added = 0, removed = 0;
  for (const line of result.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return (added || removed) ? { added, removed } : null;
}

export function ToolTile({ toolName, args, result, completed, success }: ToolTileProps) {
  const [expanded, setExpanded] = useState(false);
  const category = getToolCategory(toolName);

  const isRunning = !completed;
  const isError = completed && !success;
  const borderClass = isError ? 'border-error' : category === 'bash' ? 'border-green' : category === 'file_edit' ? 'border-blue' : category === 'file_read' ? 'border-purple' : 'border-gold';

  // Prepare display content based on tool type
  let icon: string;
  let title: React.ReactNode;
  let preview: React.ReactNode = null;
  let expandContent: React.ReactNode = null;

  if (category === 'bash') {
    const cmd = extractCommand(args);
    icon = isRunning ? '●' : (isError ? '✗' : '✓');
    title = <span className="chat-tool-label">bash</span>;
    if (cmd) {
      preview = <span className="chat-tool-command">$ {cmd}</span>;
    }
    if (result) {
      const lines = result.split('\n');
      const previewLines = lines.slice(0, 8);
      expandContent = (
        <div className="chat-tool-output">
          <pre>{expanded ? (result.length > 3000 ? result.slice(0, 3000) + '\n…(truncated)' : result) : previewLines.join('\n')}</pre>
          {lines.length > 8 && (
            <button className="chat-tool-expand" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
              {expanded ? 'Show less' : `Show more (${lines.length - 8} more lines)`}
            </button>
          )}
        </div>
      );
    }
  } else if (category === 'file_edit') {
    const rawPath = extractPath(args);
    const { name, dir } = rawPath ? friendlyPath(rawPath) : { name: formatToolLabel(toolName), dir: '' };
    icon = isRunning ? '●' : (isError ? '✗' : '✓');
    title = (
      <>
        <span className="chat-tool-filename">{name}</span>
        {dir && <span className="chat-tool-dir">{dir}</span>}
        <span className="chat-tool-action">editing</span>
      </>
    );
    const stats = result ? countDiffStats(result) : null;
    if (stats) {
      preview = (
        <span className="chat-tool-stats">
          {stats.added > 0 && <span className="stat-added">+{stats.added}</span>}
          {stats.removed > 0 && <span className="stat-removed">-{stats.removed}</span>}
        </span>
      );
    }
    if (result) {
      const lines = result.split('\n');
      const previewLines = lines.slice(0, 10);
      expandContent = (
        <div className="chat-tool-diff">
          <pre>{(expanded ? lines : previewLines).map((line, i) => {
            const cls = line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-remove' : '';
            return <span key={i} className={cls}>{line}{'\n'}</span>;
          })}</pre>
          {lines.length > 10 && (
            <button className="chat-tool-expand" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
              {expanded ? 'Collapse diff' : `Show full diff (${lines.length} lines)`}
            </button>
          )}
        </div>
      );
    }
  } else if (category === 'file_read') {
    const rawPath = extractPath(args);
    const { name, dir } = rawPath ? friendlyPath(rawPath) : { name: formatToolLabel(toolName), dir: '' };
    icon = isRunning ? '●' : '👁';
    title = (
      <>
        <span className="chat-tool-filename">{name}</span>
        {dir && <span className="chat-tool-dir">{dir}</span>}
      </>
    );
    if (result) {
      const lineCount = result.split('\n').length;
      preview = <span className="chat-tool-linecount">{lineCount} lines</span>;
      expandContent = (
        <div className="chat-tool-output">
          <pre>{expanded ? (result.length > 3000 ? result.slice(0, 3000) + '\n…(truncated)' : result) : result.split('\n').slice(0, 10).join('\n')}</pre>
          {lineCount > 10 && (
            <button className="chat-tool-expand" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
              {expanded ? 'Collapse' : `Show all (${lineCount} lines)`}
            </button>
          )}
        </div>
      );
    }
  } else {
    // Generic tool
    icon = isRunning ? '⚙️' : (isError ? '✗' : '✓');
    title = <span className="chat-tool-label">{formatToolLabel(toolName)}</span>;
    const argKeys = Object.keys(args).filter(k => !k.startsWith('_'));
    if (argKeys.length > 0) {
      const summaryItems = argKeys.slice(0, 3).map(k => {
        const v = typeof args[k] === 'string' ? (args[k] as string) : JSON.stringify(args[k]);
        const truncated = (v as string).length > 80 ? (v as string).slice(0, 77) + '…' : v;
        return `${k}: ${truncated}`;
      });
      preview = <span className="chat-tool-summary">{summaryItems.join(', ')}{argKeys.length > 3 ? ` …+${argKeys.length - 3}` : ''}</span>;
    }
    if (result) {
      expandContent = (
        <div className="chat-tool-output">
          <pre>{expanded ? (result.length > 3000 ? result.slice(0, 3000) + '\n…(truncated)' : result) : result.split('\n').slice(0, 5).join('\n')}</pre>
          {result.split('\n').length > 5 && (
            <button className="chat-tool-expand" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
              {expanded ? 'Hide details' : 'Show full data'}
            </button>
          )}
        </div>
      );
    }
  }

  const hasExpandContent = !!expandContent;

  return (
    <div className={`chat-tool-tile ${borderClass}`}>
      <div
        className="chat-tool-header"
        onClick={hasExpandContent ? () => setExpanded(!expanded) : undefined}
        role={hasExpandContent ? 'button' : undefined}
        tabIndex={hasExpandContent ? 0 : undefined}
      >
        <span className={`chat-tool-status ${isRunning ? 'running' : isError ? 'error' : 'success'}`}>{icon}</span>
        <span className="chat-tool-title">{title}</span>
        {preview && <span className="chat-tool-preview">{preview}</span>}
        {hasExpandContent && <span className={`chat-tool-chevron ${expanded ? 'expanded' : ''}`}>▸</span>}
      </div>
      {expanded && expandContent}
    </div>
  );
}
