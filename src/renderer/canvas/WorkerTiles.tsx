import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  aggregateSandboxBlocks,
  planIncidentResolve,
  truncateCommandPreview,
  type SandboxResolveDecision,
} from '../lib/sandbox-incidents';

// ── Types ──────────────────────────────────────────────────

interface AgentInfo {
  agentId: string;
  sessionId: string;
  status: string;
  summary: string;
  selectedText: string;
  createdAt?: string;
  pendingApprovalId?: string | null;
  pendingPermissionKind?: string | null;
  source?: 'sdk' | 'cli' | 'cca';
}

interface AgentStep {
  toolCallId: string;
  label: string;
  status: 'running' | 'done' | 'failed';
}

interface ApprovalInfo {
  requestId: string;
  permissionKind: string;
  intention?: string;
  path?: string;
}

interface SandboxBlockInfo {
  agentId: string;
  requestId: string;
  source: 'permission' | 'pre-tool' | 'post-tool-shell';
  kind: 'read' | 'write' | 'shell' | 'mcp' | 'url' | 'web-fetch';
  toolName?: string;
  target: string;
  intention?: string;
  allowedDecisions?: Array<'allow-once' | 'allow-for-session' | 'disable'>;
  layer?: string;
  personaHandle?: string;
}

declare const whimAPI: {
  listAgents(spaceId: string): Promise<AgentInfo[]>;
  onChatEvent(agentId: string, callback: (event: any) => void): () => void;
  onAgentStatusChanged(callback: (data: any) => void): void;
  onAgentApprovalNeeded(callback: (data: any) => void): void;
  onAgentCompleted(callback: (data: any) => void): void;
  onAgentSandboxBlocked(callback: (data: SandboxBlockInfo) => void): void;
  onAgentSandboxResolved(callback: (data: { agentId: string; requestId: string; decision: string }) => void): void;
  approveAgent(agentId: string, requestId: string, approved: boolean): Promise<void>;
  resolveSandboxBlock(agentId: string, requestId: string, decision: 'allow-once' | 'allow-for-session' | 'disable'): Promise<{ ok?: boolean; error?: string }>;
  /** Cross-window: ask main window to open the sandbox section of the
   *  persona editor for the given handle. Wired by main/preload.ts +
   *  window-manager.ts via `main-window:open-persona-sandbox-editor`. */
  openPersonaSandboxEditor(personaHandle: string): void;
  [key: string]: any;
};

// ── Helpers ────────────────────────────────────────────────

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : filePath;
}

function humanizeToolName(toolName: string, args?: Record<string, unknown>): string {
  const fileName = args?.path ? basename(String(args.path)) : '';
  if (toolName === 'bash' && args?.command) {
    const cmd = String(args.command);
    const firstWord = cmd.split(/\s/)[0].split('/').pop() || cmd;
    return `Running ${firstWord}`;
  }
  if (toolName === 'edit' && fileName) return `Editing ${fileName}`;
  if (toolName === 'create' && fileName) return `Creating ${fileName}`;
  if (toolName === 'view' && fileName) return `Reading ${fileName}`;
  const map: Record<string, string> = {
    bash: 'Running command', edit: 'Editing file', create: 'Creating file',
    view: 'Reading file', grep: 'Searching code', glob: 'Finding files',
    web_fetch: 'Fetching web page', web_search: 'Searching the web',
  };
  return map[toolName] || toolName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function describePermission(kind: string, path?: string): string {
  if (kind === 'write' && path) return `Write ${basename(path)}`;
  if (kind === 'bash') return 'Run command';
  if (kind === 'read' && path) return `Read ${basename(path)}`;
  if (kind === 'web-fetch' || kind === 'url') return 'Network access';
  if (kind === 'mcp') return 'MCP server';
  return kind;
}

// ── WorkerTiles Component ──────────────────────────────────

export interface WorkerTilesProps {
  spaceId: string;
  onSelectAgent: (agentId: string, agentPrompt: string, agentStatus: string, agentSource?: string) => void;
  selectedAgentId?: string | null;
}

export function WorkerTiles({ spaceId, onSelectAgent, selectedAgentId }: WorkerTilesProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [steps, setSteps] = useState<Map<string, AgentStep[]>>(new Map());
  const [approvals, setApprovals] = useState<Map<string, ApprovalInfo>>(new Map());
  // Pending sandbox blocks keyed agentId → requestId → block. Multiple
  // concurrent blocks per agent are possible (mxc-only parallel tool calls)
  // so we don't collapse to one block per agent.
  const [sandboxBlocks, setSandboxBlocks] = useState<Map<string, Map<string, SandboxBlockInfo>>>(new Map());
  const chatUnsubsRef = useRef<Map<string, () => void>>(new Map());

  // Load agents for this space
  const loadAgents = useCallback(async () => {
    try {
      const result = await whimAPI.listAgents(spaceId);
      setAgents(result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));

      // Populate approvals from initial data
      const newApprovals = new Map<string, ApprovalInfo>();
      for (const agent of result) {
        if (agent.status === 'waiting-approval' && agent.pendingApprovalId) {
          newApprovals.set(agent.agentId, {
            requestId: agent.pendingApprovalId,
            permissionKind: agent.pendingPermissionKind || 'permission',
          });
        }
      }
      setApprovals(newApprovals);
    } catch { /* ignore */ }
  }, [spaceId]);

  // Initial load
  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // Subscribe to per-agent chat events for steps
  useEffect(() => {
    const unsubs = chatUnsubsRef.current;

    for (const agent of agents) {
      if (unsubs.has(agent.agentId)) continue;
      if (agent.status === 'completed' || agent.status === 'failed') continue;

      const unsub = whimAPI.onChatEvent(agent.agentId, (event: any) => {
        if (event.type === 'tool.start') {
          setSteps(prev => {
            const next = new Map(prev);
            const list = [...(prev.get(agent.agentId) || [])];
            list.push({
              toolCallId: event.toolCallId,
              label: humanizeToolName(event.toolName || 'Working', event.args),
              status: 'running',
            });
            next.set(agent.agentId, list);
            return next;
          });
        } else if (event.type === 'tool.progress') {
          setSteps(prev => {
            const list = prev.get(agent.agentId);
            if (!list) return prev;
            const next = new Map(prev);
            const updated = list.map(s =>
              s.toolCallId === event.toolCallId && event.message
                ? { ...s, label: event.message }
                : s
            );
            next.set(agent.agentId, updated);
            return next;
          });
        } else if (event.type === 'tool.complete') {
          setSteps(prev => {
            const list = prev.get(agent.agentId);
            if (!list) return prev;
            const next = new Map(prev);
            const updated = list.map(s =>
              s.toolCallId === event.toolCallId
                ? { ...s, status: event.success ? 'done' as const : 'failed' as const }
                : s
            );
            next.set(agent.agentId, updated);
            return next;
          });
        } else if (event.type === 'approval.needed') {
          setApprovals(prev => {
            const next = new Map(prev);
            next.set(agent.agentId, {
              requestId: event.requestId,
              permissionKind: event.permissionKind,
              intention: event.intention,
              path: event.path,
            });
            return next;
          });
        }
      });
      unsubs.set(agent.agentId, unsub);
    }

    return () => {
      // Cleanup only removed agents
      for (const [id, unsub] of unsubs) {
        if (!agents.find(a => a.agentId === id)) {
          unsub();
          unsubs.delete(id);
        }
      }
    };
  }, [agents]);

  // Listen for global status changes to refresh
  useEffect(() => {
    const handler = () => { loadAgents(); };
    whimAPI.onAgentStatusChanged(handler);
    whimAPI.onAgentCompleted(handler);
    whimAPI.onAgentApprovalNeeded((data: any) => {
      setApprovals(prev => {
        const next = new Map(prev);
        next.set(data.agentId, {
          requestId: data.requestId,
          permissionKind: data.permissionKind || 'permission',
          intention: data.intention,
          path: data.path,
        });
        return next;
      });
      loadAgents();
    });
    whimAPI.onAgentSandboxBlocked((data: SandboxBlockInfo) => {
      setSandboxBlocks(prev => {
        const next = new Map(prev);
        const perAgent = new Map(next.get(data.agentId) ?? new Map<string, SandboxBlockInfo>());
        perAgent.set(data.requestId, data);
        next.set(data.agentId, perAgent);
        return next;
      });
    });
    whimAPI.onAgentSandboxResolved((data: { agentId: string; requestId: string; decision: string }) => {
      setSandboxBlocks(prev => {
        const perAgent = prev.get(data.agentId);
        if (!perAgent || !perAgent.has(data.requestId)) return prev;
        const next = new Map(prev);
        const updated = new Map(perAgent);
        updated.delete(data.requestId);
        if (updated.size === 0) next.delete(data.agentId);
        else next.set(data.agentId, updated);
        return next;
      });
    });
  }, [loadAgents]);

  // Cleanup all subs on unmount
  useEffect(() => {
    return () => {
      for (const unsub of chatUnsubsRef.current.values()) unsub();
      chatUnsubsRef.current.clear();
    };
  }, []);

  const handleApprove = useCallback(async (agentId: string, requestId: string, approved: boolean) => {
    await whimAPI.approveAgent(agentId, requestId, approved);
    setApprovals(prev => {
      const next = new Map(prev);
      next.delete(agentId);
      return next;
    });
  }, []);

  /** Resolve a multi-block incident with a single decision.  Staged fan-out:
   *  the first requestId carries the real decision (which triggers at most
   *  one `disableSandboxForSession` flip in the runtime), and the rest dismiss
   *  with `'allow-once'` so we don't race multiple retry prompts. */
  const handleResolveIncident = useCallback(
    (agentId: string, requestIds: string[], decision: SandboxResolveDecision) => {
      const plan = planIncidentResolve({ requestIds }, decision);
      for (const step of plan) {
        whimAPI.resolveSandboxBlock(agentId, step.requestId, step.decision);
      }
    },
    [],
  );

  const handleOpenSandboxEditor = useCallback((personaHandle: string | undefined) => {
    if (!personaHandle) return;
    if (typeof whimAPI.openPersonaSandboxEditor === 'function') {
      whimAPI.openPersonaSandboxEditor(personaHandle);
    }
  }, []);

  if (agents.length === 0) return null;

  return (
    <div className="canvas-worker-tiles">
      {agents.map(agent => {
        const agentSteps = steps.get(agent.agentId) || [];
        const lastStep = agentSteps.length > 0 ? agentSteps[agentSteps.length - 1] : null;
        const approval = approvals.get(agent.agentId);
        const isSelected = selectedAgentId === agent.agentId;
        const isRunning = agent.status === 'running';
        const isWaiting = agent.status === 'waiting-approval';

        const preview = agent.selectedText.length > 50
          ? agent.selectedText.slice(0, 47) + '…'
          : agent.selectedText;

        const blocksForAgent = sandboxBlocks.get(agent.agentId);
        const incidents = blocksForAgent
          ? aggregateSandboxBlocks(blocksForAgent.values())
          : [];

        return (
          <div
            key={agent.agentId}
            className={`worker-tile ${agent.status} ${isSelected ? 'selected' : ''}`}
            onClick={() => onSelectAgent(agent.agentId, agent.selectedText, agent.status, agent.source)}
          >
            <div className="worker-tile-status">
              {isRunning && <span className="worker-dot running" />}
              {isWaiting && <span className="worker-dot waiting" />}
              {agent.status === 'completed' && <span className="worker-dot completed">✓</span>}
              {agent.status === 'failed' && <span className="worker-dot failed">✗</span>}
            </div>
            <div className="worker-tile-content">
              <div className="worker-tile-task">{preview || agent.summary || 'Agent session'}</div>
              {lastStep && isRunning && (
                <div className="worker-tile-step">
                  <span className={`step-dot ${lastStep.status}`} />
                  <span className="step-text">{lastStep.label}</span>
                </div>
              )}
              {approval && (
                <div className="worker-tile-approval" onClick={e => e.stopPropagation()}>
                  <span className="approval-desc">{describePermission(approval.permissionKind, approval.path)}</span>
                  <button
                    className="tile-approve-btn approve"
                    onClick={() => handleApprove(agent.agentId, approval.requestId, true)}
                  >✓</button>
                  <button
                    className="tile-approve-btn deny"
                    onClick={() => handleApprove(agent.agentId, approval.requestId, false)}
                  >✗</button>
                </div>
              )}
              {incidents.map(incident => {
                const block = incident.sample;
                const isPostTool = block.source === 'post-tool-shell';
                const decisions = (block.allowedDecisions ?? ['allow-once', 'allow-for-session', 'disable']);
                const truncated = truncateCommandPreview(block.target, 40);
                const layerTip = [
                  block.layer ? `Layer: ${block.layer}` : null,
                  block.intention ? `Why: ${block.intention}` : null,
                  block.personaHandle ? `Persona: @${block.personaHandle}` : null,
                  block.kind ? `Kind: ${block.kind}` : null,
                  block.toolName ? `Tool: ${block.toolName}` : null,
                ].filter(Boolean).join('\n');
                return (
                  <div
                    key={incident.key}
                    className="worker-tile-sandbox-incident"
                    onClick={e => e.stopPropagation()}
                    title={layerTip || undefined}
                  >
                    <div className="sandbox-incident-cmd-row">
                      <span className="sandbox-incident-lock" aria-hidden="true">🔒</span>
                      <span className="sandbox-incident-cmd" title={block.target}>{truncated}</span>
                      {incident.count > 1 && (
                        <span
                          className="sandbox-incident-count"
                          title={`${incident.count} identical attempts`}
                        >
                          ×{incident.count}
                        </span>
                      )}
                    </div>
                    <div className="sandbox-incident-actions">
                      {decisions.map(d => (
                        <button
                          key={d}
                          type="button"
                          className="sandbox-incident-btn"
                          onClick={() =>
                            handleResolveIncident(agent.agentId, incident.requestIds, d)
                          }
                        >
                          {d === 'allow-once'
                            ? 'Allow once'
                            : d === 'allow-for-session'
                              ? 'Allow session'
                              : isPostTool ? 'Disable & retry' : 'Disable'}
                        </button>
                      ))}
                      {isPostTool && (
                        <button
                          type="button"
                          className="sandbox-incident-btn ignore"
                          onClick={() =>
                            handleResolveIncident(agent.agentId, incident.requestIds, 'allow-once')
                          }
                        >
                          Ignore
                        </button>
                      )}
                      {block.personaHandle && (
                        <button
                          type="button"
                          className="sandbox-incident-btn icon"
                          title="Edit sandbox config in main window"
                          aria-label="Edit sandbox config"
                          onClick={() => handleOpenSandboxEditor(block.personaHandle)}
                        >
                          ⚙
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
