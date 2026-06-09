import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic, Strikethrough, Code, MessageSquarePlus, GitFork, FileOutput, Check, Trash2, CornerDownLeft } from 'lucide-react';
import type { CommentThread } from '../types';
import type { Rect, FormatMark } from './geometry';
import { useAnchoredPosition } from './floating';

/** Render floating UI on document.body so it escapes the app's backdrop-filter
 *  containing block (which otherwise breaks position: fixed coordinates). */
function Floating({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return <>{children}</>;
  return createPortal(children, document.body);
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Floating toolbar shown over a text selection. */
export function SelectionToolbar({
  rect,
  onFormat,
  onComment,
  onFork,
  onExtract,
}: {
  rect: Rect;
  onFormat: (mark: FormatMark) => void;
  onComment: () => void;
  onFork?: () => void;
  onExtract?: () => void;
}) {
  const { ref, style } = useAnchoredPosition(rect, { placement: 'above', align: 'center' });
  return (
    <Floating>
      <div ref={ref} className="md-selection-toolbar" style={style} onMouseDown={(e) => e.preventDefault()}>
        <button className="md-selection-btn md-selection-icon" title="Bold (⌘B)" onClick={() => onFormat('strong')}>
          <Bold size={14} />
        </button>
        <button className="md-selection-btn md-selection-icon" title="Italic (⌘I)" onClick={() => onFormat('emphasis')}>
          <Italic size={14} />
        </button>
        <button className="md-selection-btn md-selection-icon" title="Strikethrough" onClick={() => onFormat('strikethrough')}>
          <Strikethrough size={14} />
        </button>
        <button className="md-selection-btn md-selection-icon" title="Inline code" onClick={() => onFormat('inlineCode')}>
          <Code size={14} />
        </button>
        <span className="md-selection-sep" />
        <button className="md-selection-btn" title="Comment" onClick={onComment}>
          <MessageSquarePlus size={14} />
          <span>Comment</span>
        </button>
        {onFork && (
          <button className="md-selection-btn md-selection-icon" title="Fork to new space" onClick={onFork}>
            <GitFork size={14} />
          </button>
        )}
        {onExtract && (
          <button className="md-selection-btn md-selection-icon" title="Extract to page" onClick={onExtract}>
            <FileOutput size={14} />
          </button>
        )}
      </div>
    </Floating>
  );
}

/** Composer for the first comment on a freshly selected range. */
export function CommentComposer({
  rect,
  quote,
  onSubmit,
  onCancel,
}: {
  rect: Rect;
  quote: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { ref, style } = useAnchoredPosition(rect, { placement: 'below', align: 'start', gap: 6 });
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = () => {
    const t = body.trim();
    if (t) onSubmit(t);
  };

  return (
    <Floating>
      <div ref={ref} className="md-comment-popover" style={style} onMouseDown={(e) => e.stopPropagation()}>
        <div className="md-comment-quote">{quote.length > 120 ? quote.slice(0, 120) + '…' : quote}</div>
        <textarea
          ref={inputRef}
          className="md-comment-input"
          placeholder="Add a comment…  (@mention an agent to deploy it)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
        />
        <div className="md-comment-actions">
          <button className="md-comment-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="md-comment-btn-primary" onClick={submit} disabled={!body.trim()}>
            <CornerDownLeft size={12} /> Comment
          </button>
        </div>
      </div>
    </Floating>
  );
}

/** Thread popover: existing comments + reply box + resolve/delete. */
export function CommentPopover({
  thread,
  rect,
  roster,
  onReply,
  onResolve,
  onDelete,
  onClose,
}: {
  thread: CommentThread;
  rect: Rect;
  roster: readonly string[];
  onReply: (body: string) => void;
  onResolve: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState('');
  const { ref, style } = useAnchoredPosition(rect, { placement: 'below', align: 'start', gap: 6 });
  void roster;

  const submit = () => {
    const t = body.trim();
    if (t) { onReply(t); setBody(''); }
  };

  return (
    <Floating>
      <div ref={ref} className="md-comment-popover" style={style} onMouseDown={(e) => e.stopPropagation()}>
        <div className="md-comment-header">
          <span className="md-comment-quote-inline">“{thread.quote.length > 80 ? thread.quote.slice(0, 80) + '…' : thread.quote}”</span>
          <div className="md-comment-header-actions">
            <button className="md-comment-icon" title={thread.resolvedAt ? 'Resolved' : 'Resolve'} onClick={onResolve}>
              <Check size={13} />
            </button>
            <button className="md-comment-icon" title="Delete thread" onClick={onDelete}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        <div className="md-comment-list">
          {thread.comments.map((c, i) => (
            <div className="md-comment-item" key={i}>
              <div className="md-comment-body">{c.body}</div>
              <div className="md-comment-meta">{formatTime(c.updatedAt)}</div>
            </div>
          ))}
        </div>
        <textarea
          className="md-comment-input"
          placeholder="Reply…  (@mention to deploy an agent)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
        <div className="md-comment-actions">
          <button className="md-comment-btn-ghost" onClick={onClose}>Close</button>
          <button className="md-comment-btn-primary" onClick={submit} disabled={!body.trim()}>
            <CornerDownLeft size={12} /> Reply
          </button>
        </div>
      </div>
    </Floating>
  );
}
