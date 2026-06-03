import React, { useMemo, useState } from 'react';

export type DiffLineKind = 'add' | 'remove' | 'context';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNum?: number;
  newNum?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  section: string;
  lines: DiffLine[];
}

export type DiffFileKind = 'modified' | 'added' | 'deleted' | 'renamed';

export interface DiffFile {
  oldPath: string;
  newPath: string;
  kind: DiffFileKind;
  hunks: DiffHunk[];
  added: number;
  removed: number;
}

export interface ParsedDiff {
  files: DiffFile[];
  added: number;
  removed: number;
}

// Strip the noisy `a/` / `b/` prefix git puts on paths in unified diffs.
function stripPrefix(p: string): string {
  if (p === '/dev/null') return p;
  if (p.startsWith('a/') || p.startsWith('b/')) return p.slice(2);
  return p;
}

// Best-effort unified-diff parser. Tolerant of partial input — anything that
// doesn't look like a diff is rejected by the caller (which falls back to a
// raw <pre>).
export function parseUnifiedDiff(input: string): ParsedDiff | null {
  if (!input) return null;
  const lines = input.split('\n');
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  const startFile = (oldPath: string, newPath: string): DiffFile => {
    const f: DiffFile = {
      oldPath: stripPrefix(oldPath),
      newPath: stripPrefix(newPath),
      kind: 'modified',
      hunks: [],
      added: 0,
      removed: 0,
    };
    files.push(f);
    currentHunk = null;
    return f;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('diff --git ')) {
      // diff --git a/path b/path  — extract both paths
      const m = line.match(/^diff --git (.+?) (.+)$/);
      if (m) {
        current = startFile(m[1], m[2]);
      } else {
        current = startFile('', '');
      }
      continue;
    }

    if (line.startsWith('new file mode')) {
      if (current) current.kind = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      if (current) current.kind = 'deleted';
      continue;
    }
    if (line.startsWith('rename from') || line.startsWith('rename to')) {
      if (current) current.kind = 'renamed';
      continue;
    }
    if (line.startsWith('similarity index') || line.startsWith('index ') || line.startsWith('Binary files')) {
      continue;
    }

    if (line.startsWith('--- ')) {
      const path = line.slice(4).trim();
      if (!current) current = startFile(path, '');
      else current.oldPath = stripPrefix(path);
      if (path === '/dev/null' && current) current.kind = 'added';
      continue;
    }
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim();
      if (!current) current = startFile('', path);
      else current.newPath = stripPrefix(path);
      if (path === '/dev/null' && current) current.kind = 'deleted';
      continue;
    }

    if (line.startsWith('@@')) {
      // @@ -oldStart,oldLines +newStart,newLines @@ optional section header
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (!m) continue;
      if (!current) current = startFile('', '');
      currentHunk = {
        oldStart: parseInt(m[1], 10),
        oldLines: m[2] ? parseInt(m[2], 10) : 1,
        newStart: parseInt(m[3], 10),
        newLines: m[4] ? parseInt(m[4], 10) : 1,
        section: (m[5] || '').trim(),
        lines: [],
      };
      current.hunks.push(currentHunk);
      oldLineNo = currentHunk.oldStart;
      newLineNo = currentHunk.newStart;
      continue;
    }

    if (!currentHunk) continue;

    // "\ No newline at end of file" — skip
    if (line.startsWith('\\')) continue;

    const first = line.charAt(0);
    if (first === '+') {
      currentHunk.lines.push({ kind: 'add', text: line.slice(1), newNum: newLineNo });
      newLineNo++;
      if (current) current.added++;
    } else if (first === '-') {
      currentHunk.lines.push({ kind: 'remove', text: line.slice(1), oldNum: oldLineNo });
      oldLineNo++;
      if (current) current.removed++;
    } else {
      // context (space) — also handle bare empty lines as context
      const text = first === ' ' ? line.slice(1) : line;
      currentHunk.lines.push({ kind: 'context', text, oldNum: oldLineNo, newNum: newLineNo });
      oldLineNo++;
      newLineNo++;
    }
  }

  if (files.length === 0) return null;

  let added = 0;
  let removed = 0;
  for (const f of files) {
    added += f.added;
    removed += f.removed;
  }
  return { files, added, removed };
}

function basename(p: string): string {
  if (!p || p === '/dev/null') return '';
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1];
}

function dirname(p: string): string {
  if (!p || p === '/dev/null') return '';
  const parts = p.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/');
}

function fileKindLabel(kind: DiffFileKind): string {
  switch (kind) {
    case 'added': return 'new file';
    case 'deleted': return 'deleted';
    case 'renamed': return 'renamed';
    default: return '';
  }
}

interface DiffViewerProps {
  parsed: ParsedDiff;
  // When true, only render an initial slice of lines per file with an
  // "Expand" affordance. Default true.
  collapsible?: boolean;
  previewLines?: number;
}

export function DiffViewer({ parsed, collapsible = true, previewLines = 14 }: DiffViewerProps) {
  return (
    <div className="diff-viewer">
      {parsed.files.map((file, i) => (
        <DiffFileBlock key={i} file={file} collapsible={collapsible} previewLines={previewLines} />
      ))}
    </div>
  );
}

interface DiffFileBlockProps {
  file: DiffFile;
  collapsible: boolean;
  previewLines: number;
}

function DiffFileBlock({ file, collapsible, previewLines }: DiffFileBlockProps) {
  const totalLines = useMemo(() => file.hunks.reduce((n, h) => n + h.lines.length, 0), [file.hunks]);
  const shouldCollapse = collapsible && totalLines > previewLines;
  const [expanded, setExpanded] = useState(!shouldCollapse);

  const displayPath = file.newPath && file.newPath !== '/dev/null' ? file.newPath : file.oldPath;
  const name = basename(displayPath) || '(unknown)';
  const dir = dirname(displayPath);
  const kindLabel = fileKindLabel(file.kind);

  // Build the flat list of (hunk, line) entries we will render.
  let budget = expanded ? Infinity : previewLines;
  const renderedHunks: Array<{ hunk: DiffHunk; lines: DiffLine[]; truncated: boolean }> = [];
  for (const hunk of file.hunks) {
    if (budget <= 0) break;
    const take = Math.min(hunk.lines.length, budget);
    renderedHunks.push({
      hunk,
      lines: hunk.lines.slice(0, take),
      truncated: take < hunk.lines.length,
    });
    budget -= take;
  }

  // How wide to size the gutter — fit the largest line number we render.
  const maxLineNo = useMemo(() => {
    let m = 0;
    for (const h of file.hunks) {
      for (const l of h.lines) {
        if (l.oldNum && l.oldNum > m) m = l.oldNum;
        if (l.newNum && l.newNum > m) m = l.newNum;
      }
    }
    return m;
  }, [file.hunks]);
  const gutterCh = Math.max(2, String(maxLineNo || 1).length);

  return (
    <div className={`diff-file diff-file-${file.kind}`}>
      <div className="diff-file-header">
        <span className="diff-file-icon" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 1.5h4.5L9.5 4v6.5a.5.5 0 0 1-.5.5h-6.5a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
            <path d="M7 1.5V4h2.5" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
          </svg>
        </span>
        <span className="diff-file-name">{name}</span>
        {dir && <span className="diff-file-dir">{dir}</span>}
        {kindLabel && <span className={`diff-file-badge badge-${file.kind}`}>{kindLabel}</span>}
        <span className="diff-file-stats">
          {file.added > 0 && <span className="diff-stat-add">+{file.added}</span>}
          {file.removed > 0 && <span className="diff-stat-remove">−{file.removed}</span>}
        </span>
      </div>
      <div className="diff-file-body" style={{ ['--diff-gutter-ch' as string]: `${gutterCh}ch` }}>
        {renderedHunks.map((entry, hi) => (
          <React.Fragment key={hi}>
            {entry.hunk.section ? (
              <div className="diff-hunk-header">
                <span className="diff-hunk-range">
                  @@ −{entry.hunk.oldStart},{entry.hunk.oldLines} +{entry.hunk.newStart},{entry.hunk.newLines} @@
                </span>
                <span className="diff-hunk-section">{entry.hunk.section}</span>
              </div>
            ) : hi > 0 ? (
              <div className="diff-hunk-divider" aria-hidden="true" />
            ) : null}
            {entry.lines.map((line, li) => (
              <DiffRow key={li} line={line} />
            ))}
            {entry.truncated && !expanded && (
              <div className="diff-truncated">… {entry.hunk.lines.length - entry.lines.length} more lines in this hunk</div>
            )}
          </React.Fragment>
        ))}
      </div>
      {shouldCollapse && (
        <button
          type="button"
          className="diff-file-expand"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          {expanded ? 'Collapse diff' : `Show full diff (${totalLines} lines)`}
        </button>
      )}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  const marker = line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ';
  return (
    <div className={`diff-row diff-row-${line.kind}`}>
      <span className="diff-gutter diff-gutter-old">{line.oldNum ?? ''}</span>
      <span className="diff-gutter diff-gutter-new">{line.newNum ?? ''}</span>
      <span className="diff-marker" aria-hidden="true">{marker}</span>
      <span className="diff-code">{line.text || '\u00A0'}</span>
    </div>
  );
}
