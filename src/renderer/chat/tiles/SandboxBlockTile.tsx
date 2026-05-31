import React from 'react';

interface SandboxBlockTileProps {
  requestId: string;
  agentId: string;
  source: 'permission' | 'pre-tool' | 'post-tool-shell';
  kind: 'read' | 'write' | 'shell' | 'mcp' | 'url' | 'web-fetch';
  toolName?: string;
  target: string;
  intention?: string;
  allowedDecisions?: Array<'allow-once' | 'allow-for-session' | 'disable'>;
  layer?: string;
  personaHandle?: string;
  responded: boolean;
  decision?: 'allow-once' | 'allow-for-session' | 'disable';
  onResolve: (
    agentId: string,
    requestId: string,
    decision: 'allow-once' | 'allow-for-session' | 'disable',
  ) => void;
  onEditSandboxConfig?: (personaHandle: string) => void;
}

const DECISION_LABELS: Record<'allow-once' | 'allow-for-session' | 'disable', string> = {
  'allow-once': 'Allow once',
  'allow-for-session': 'Allow for session',
  'disable': 'Disable sandbox',
};

const RESOLVED_LABELS: Record<'allow-once' | 'allow-for-session' | 'disable', string> = {
  'allow-once': '✓ Allowed once',
  'allow-for-session': '✓ Allowed for session',
  'disable': '🔓 Sandbox disabled',
};

/**
 * Inline sandbox-block tile shown in the chat thread when the broker emits
 * `sandbox.blocked`.  Mirrors the Workers-tab AgentsList SandboxBlockPanel
 * action set so the user can resolve a block (allow once / allow for session /
 * disable) without leaving the chat view.
 *
 * Renders `responded` state when the broker subsequently emits
 * `sandbox.resolved` with the matching requestId — either from the same
 * window's actions or from a resolution made elsewhere (e.g. the Workers tab
 * or an OS notification action).
 */
export function SandboxBlockTile({
  requestId,
  agentId,
  source,
  kind,
  toolName,
  target,
  intention,
  allowedDecisions,
  layer,
  personaHandle,
  responded,
  decision,
  onResolve,
  onEditSandboxConfig,
}: SandboxBlockTileProps): React.ReactElement {
  const decisions = allowedDecisions ?? ['allow-once', 'allow-for-session', 'disable'];
  const labels: Record<'allow-once' | 'allow-for-session' | 'disable', string> = {
    ...DECISION_LABELS,
    // Post-tool-shell blocks fire after MXC already denied the tool at the OS
    // level — "Disable" then both disables the sandbox AND triggers a retry
    // prompt via `disableSandboxForSession`, so the label sets that
    // expectation. Pre-tool blocks just disable; the in-flight call proceeds
    // because the broker callback returns `allow`.
    disable: source === 'post-tool-shell' ? 'Disable sandbox & retry' : DECISION_LABELS.disable,
  };
  const title = source === 'post-tool-shell'
    ? 'Possible sandbox denial'
    : `Sandbox blocked: ${kind}${toolName ? ` (${toolName})` : ''}`;
  const layerLabel = layer
    ? (layer.startsWith('mxc:') || layer.startsWith('mxc-only:')
      ? `Enforced by: MXC (${layer})`
      : `Enforced by: host (${layer})`)
    : null;

  return (
    <div className={`chat-sandbox-block agent-card-sandbox-block ${responded ? 'responded' : ''}`}>
      <div className="sandbox-block-header">
        <span className="sandbox-block-icon">🔒</span>
        <div className="sandbox-block-info">
          <span className="sandbox-block-title">{title}</span>
          {personaHandle ? (
            <span className="sandbox-block-persona">@{personaHandle}</span>
          ) : null}
          {layerLabel ? <span className="sandbox-block-layer">{layerLabel}</span> : null}
        </div>
      </div>
      <div className="sandbox-block-body">
        {intention ? <div className="sandbox-block-intention">{intention}</div> : null}
        <div className="sandbox-block-target">Target: {target}</div>
      </div>
      {responded ? (
        <div className="sandbox-block-resolved">
          {decision ? RESOLVED_LABELS[decision] : '✓ Resolved'}
        </div>
      ) : (
        <div className="sandbox-block-actions">
          {decisions.map(d => (
            <button
              key={d}
              type="button"
              className="sandbox-block-btn"
              onClick={() => onResolve(agentId, requestId, d)}
            >
              {labels[d]}
            </button>
          ))}
          {source === 'post-tool-shell' ? (
            <button
              type="button"
              className="sandbox-block-btn"
              onClick={() => onResolve(agentId, requestId, 'allow-once')}
            >
              Ignore
            </button>
          ) : null}
          {personaHandle && onEditSandboxConfig ? (
            <button
              type="button"
              className="sandbox-block-btn sandbox-block-btn-edit"
              title={`Open the @${personaHandle} persona to tweak its sandbox policy. ` +
                'Changes apply to FUTURE sessions launched with this persona — they do ' +
                'not modify the currently blocked agent.'}
              onClick={() => onEditSandboxConfig(personaHandle)}
            >
              Edit sandbox config
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
