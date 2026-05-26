import React, { useState, useEffect, useCallback, useRef } from 'react';

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
  source?: 'sdk' | 'cli' | 'cca' | 'conduit';
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

declare const whimAPI: {
  listAgents(spaceId: string): Promise<AgentInfo[]>;
  onChatEvent(agentId: string, callback: (event: any) => void): () => void;
  onAgentStatusChanged(callback: (data: any) => void): void;
  onAgentApprovalNeeded(callback: (data: any) => void): void;
  onAgentCompleted(callback: (data: any) => void): void;
  approveAgent(agentId: string, requestId: string, approved: boolean): Promise<void>;
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
            </div>
          </div>
        );
      })}
    </div>
  );
}
