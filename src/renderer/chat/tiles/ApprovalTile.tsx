import React from 'react';

interface ApprovalTileProps {
  requestId: string;
  permissionKind: string;
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

export function ApprovalTile({ requestId, permissionKind, responded, approved, onRespond }: ApprovalTileProps) {
  return (
    <div className={`chat-approval-tile ${responded ? 'responded' : 'pending'}`}>
      <div className="chat-approval-icon">⚠️</div>
      <div className="chat-approval-body">
        <div className="chat-approval-label">Permission requested</div>
        <div className="chat-approval-kind">{describePermission(permissionKind)}</div>
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
