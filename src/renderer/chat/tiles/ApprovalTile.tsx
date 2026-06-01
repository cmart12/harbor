import React, { useRef, useState, useLayoutEffect } from 'react';

interface ApprovalTileProps {
  requestId: string;
  permissionKind: string;
  intention?: string;
  path?: string;
  responded: boolean;
  approved?: boolean;
  onRespond: (requestId: string, approved: boolean) => void;
}

function describePermission(kind: string): string {
  if (kind.includes('file') || kind.includes('write')) return 'Write to files';
  if (kind.includes('bash') || kind.includes('exec') || kind.includes('command')) return 'Execute a command';
  if (kind.includes('read')) return 'Read files';
  return kind.replace(/_/g, ' ');
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p;
}

export function ApprovalTile({ requestId, permissionKind, intention, path, responded, approved, onRespond }: ApprovalTileProps) {
  const detail = path ? shortPath(path) : intention || '';
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  // Detect whether the single-line detail is actually being clipped, so we
  // only show the expand chevron when there's something hidden to reveal.
  useLayoutEffect(() => {
    const el = detailRef.current;
    if (!el || expanded) return;
    setTruncated(el.scrollWidth > el.clientWidth + 1);
  }, [detail, expanded]);

  return (
    <div className={`chat-approval-tile ${responded ? 'responded' : 'pending'}`}>
      <div className="chat-approval-icon">⚠️</div>
      <div className="chat-approval-body">
        <div className="chat-approval-label">Permission requested</div>
        <div className="chat-approval-kind">{describePermission(permissionKind)}</div>
        {detail && (
          <div
            ref={detailRef}
            className={`chat-approval-detail${expanded ? ' expanded' : ''}${truncated || expanded ? ' clickable' : ''}`}
            onClick={truncated || expanded ? () => setExpanded(e => !e) : undefined}
            role={truncated || expanded ? 'button' : undefined}
            tabIndex={truncated || expanded ? 0 : undefined}
            title={truncated && !expanded ? 'Click to expand' : expanded ? 'Click to collapse' : undefined}
          >
            {detail}
            {(truncated || expanded) && (
              <span className="chat-approval-detail-chevron">{expanded ? ' ▴' : ' ▾'}</span>
            )}
          </div>
        )}
        {responded ? (
          <div className={`chat-approval-result ${approved ? 'approved' : 'denied'}`}>
            {approved ? '✓ Approved' : '✗ Denied'}
          </div>
        ) : (
          <div className="chat-approval-actions">
            <button
              className="chat-approval-btn approve"
              onClick={() => onRespond(requestId, true)}
            >
              Approve
            </button>
            <button
              className="chat-approval-btn deny"
              onClick={() => onRespond(requestId, false)}
            >
              Deny
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
