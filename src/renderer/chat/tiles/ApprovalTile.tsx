import React from 'react';

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

  return (
    <div className={`chat-approval-tile ${responded ? 'responded' : 'pending'}`}>
      <div className="chat-approval-icon">⚠️</div>
      <div className="chat-approval-body">
        <div className="chat-approval-label">Permission requested</div>
        <div className="chat-approval-kind">{describePermission(permissionKind)}</div>
        {detail && <div className="chat-approval-detail">{detail}</div>}
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
