import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from 'react';
import {
  Documint,
  lightTheme,
  darkTheme,
  type DocumintState,
  type CommentThread,
  type CommentThreadSlots,
} from 'documint';

declare const intentAPI: {
  writeCanvas(intentId: string, content: string): Promise<void>;
  pasteFile(intentId: string, filename: string, dataArray: number[]): Promise<{ error?: string; filename?: string; relativePath?: string }>;
  launchAgent(intentId: string, selectedText: string, anchor: any, options?: { repo?: string; model?: string }): Promise<{ agentId?: string; sessionId?: string; error?: string }>;
  approveAgent(agentId: string, requestId: string, approved: boolean): Promise<void>;
  openAgentCli(agentId: string): Promise<{ error?: string }>;
  listModels(): Promise<{ id: string; name?: string }[]>;
  getSetting(key: string): Promise<string | null>;
  onAgentStatusChanged(callback: (data: { agentId: string; status: string; summary?: string }) => void): void;
  onAgentApprovalNeeded(callback: (data: { agentId: string; requestId: string; permissionKind: string }) => void): void;
  onAgentCompleted(callback: (data: { agentId: string; summary?: string }) => void): void;
};

export interface DocumintCanvasProps {
  intentId: string;
  initialContent: string;
  theme: 'light' | 'dark';
  onDirtyChange: (dirty: boolean) => void;
  onSaveStatus: (status: string) => void;
}

export interface DocumintCanvasHandle {
  saveNow(): Promise<void>;
  getContent(): string;
}

const AUTOSAVE_DELAY_MS = 2000;

interface AgentInfo {
  agentId: string;
  sessionId: string;
  threadId: string;
  selectedText: string;
  quote: string;
  prefix: string;
  suffix: string;
  status: string;
  summary: string;
  instructions: string;
}

interface ThreadConfig {
  repo: string;
  model: string;
  expanded: boolean;
  launching: boolean;
}

function formatAttachmentRef(filename: string, relativePath: string, mimeType: string): string {
  if (mimeType.startsWith('image/')) {
    return `\n![${filename}](${relativePath})\n`;
  }
  const icon = mimeType.startsWith('audio/') ? '🎵' :
               mimeType.startsWith('video/') ? '🎬' : '📎';
  return `\n[${icon} ${filename}](${relativePath})\n`;
}

export const DocumintCanvas = forwardRef<DocumintCanvasHandle, DocumintCanvasProps>(
  function DocumintCanvas({ intentId, initialContent, theme, onDirtyChange, onSaveStatus }, ref) {
    const [content, setContent] = useState(initialContent);
    const lastSavedRef = useRef(initialContent);
    const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savingRef = useRef(false);
    const contentRef = useRef(content);
    const stateRef = useRef<DocumintState | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Agent tracking — keyed by thread ID for stability
    const [runningAgents, setRunningAgents] = useState<AgentInfo[]>([]);
    const [approvalRequest, setApprovalRequest] = useState<{ agentId: string; requestId: string; permissionKind: string } | null>(null);
    const [flashTick, setFlashTick] = useState(0);

    // Per-thread config for agent launch (repo, model, etc.)
    const [threadConfigs, setThreadConfigs] = useState<Map<string, ThreadConfig>>(new Map());
    const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
    // Tracks when ⚡ was clicked in the create composer — auto-launch on thread creation
    const pendingLaunchRef = useRef(false);

    contentRef.current = content;

    // Load available models once
    useEffect(() => {
      intentAPI.listModels().then(setModels).catch(() => {});
    }, []);

    const doSave = useCallback(async () => {
      if (savingRef.current) return;
      const currentContent = contentRef.current;
      if (currentContent === lastSavedRef.current) return;

      savingRef.current = true;
      try {
        await intentAPI.writeCanvas(intentId, currentContent);
        lastSavedRef.current = currentContent;
        onDirtyChange(contentRef.current !== lastSavedRef.current);
        onSaveStatus('✓');
        setTimeout(() => onSaveStatus(''), 1500);
      } catch {
        onSaveStatus('✗ save failed');
        setTimeout(() => onSaveStatus(''), 3000);
      } finally {
        savingRef.current = false;
      }
    }, [intentId, onDirtyChange, onSaveStatus]);

    const scheduleSave = useCallback(() => {
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
      pendingSaveRef.current = setTimeout(() => {
        pendingSaveRef.current = null;
        doSave();
      }, AUTOSAVE_DELAY_MS);
    }, [doSave]);

    const saveNow = useCallback(async () => {
      if (pendingSaveRef.current) {
        clearTimeout(pendingSaveRef.current);
        pendingSaveRef.current = null;
      }
      await doSave();
    }, [doSave]);

    useImperativeHandle(ref, () => ({
      saveNow,
      getContent: () => contentRef.current,
    }), [saveNow]);

    const handleContentChange = useCallback((newContent: string) => {
      // Strip agent comment directive (we inject it ourselves for decoration)
      const stripped = newContent.replace(/\n*:::documint-comments\n[\s\S]*?\n:::\s*$/, '');
      if (stripped === contentRef.current) return;
      setContent(stripped);
      const dirty = stripped !== lastSavedRef.current;
      onDirtyChange(dirty);
      if (dirty) {
        onSaveStatus('');
        scheduleSave();
      }
    }, [onDirtyChange, onSaveStatus, scheduleSave]);

    const handleStateChange = useCallback((state: DocumintState) => {
      stateRef.current = state;
    }, []);

    // Cmd+S handler
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const handler = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault();
          saveNow();
        }
      };
      el.addEventListener('keydown', handler);
      return () => el.removeEventListener('keydown', handler);
    }, [saveNow]);

    // File paste handler (capture phase)
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const handlePaste = async (e: ClipboardEvent) => {
        if (!e.clipboardData) return;
        const files = e.clipboardData.files;
        if (files.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        for (const file of Array.from(files)) {
          try {
            const buffer = await file.arrayBuffer();
            const dataArray = Array.from(new Uint8Array(buffer));
            onSaveStatus('📎...');
            const result = await intentAPI.pasteFile(intentId, file.name, dataArray);

            if (result.error) {
              onSaveStatus('✗ ' + result.error);
              setTimeout(() => onSaveStatus(''), 3000);
              continue;
            }

            const ref = formatAttachmentRef(result.filename!, result.relativePath!, file.type);
            insertAttachment(ref);
          } catch {
            onSaveStatus('✗ paste failed');
            setTimeout(() => onSaveStatus(''), 3000);
          }
        }
      };

      const handleDragOver = (e: DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
      };

      const handleDragLeave = () => {
        setIsDragging(false);
      };

      const handleDrop = async (e: DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (!e.dataTransfer?.files.length) return;

        for (const file of Array.from(e.dataTransfer.files)) {
          try {
            const buffer = await file.arrayBuffer();
            const dataArray = Array.from(new Uint8Array(buffer));
            const result = await intentAPI.pasteFile(intentId, file.name, dataArray);

            if (result.error) {
              onSaveStatus('✗ ' + result.error);
              setTimeout(() => onSaveStatus(''), 3000);
              continue;
            }

            const ref = formatAttachmentRef(result.filename!, result.relativePath!, file.type);
            insertAttachment(ref);
          } catch {
            onSaveStatus('✗ drop failed');
            setTimeout(() => onSaveStatus(''), 3000);
          }
        }
      };

      // Capture phase to intercept before Documint's hidden textarea
      el.addEventListener('paste', handlePaste, true);
      el.addEventListener('dragover', handleDragOver);
      el.addEventListener('dragleave', handleDragLeave);
      el.addEventListener('drop', handleDrop);

      return () => {
        el.removeEventListener('paste', handlePaste, true);
        el.removeEventListener('dragover', handleDragOver);
        el.removeEventListener('dragleave', handleDragLeave);
        el.removeEventListener('drop', handleDrop);
      };
    }, [intentId, onSaveStatus]); // eslint-disable-line react-hooks/exhaustive-deps

    function insertAttachment(markdownRef: string) {
      const current = contentRef.current;
      const state = stateRef.current;

      if (state && state.canonicalContent === current && state.selectionTo >= 0) {
        const pos = state.selectionTo;
        const before = current.slice(0, pos);
        const after = current.slice(pos);
        handleContentChange(before + markdownRef + after);
      } else {
        const separator = current.endsWith('\n') ? '' : '\n';
        handleContentChange(current + separator + markdownRef);
      }
    }

    // Cleanup pending save on unmount
    useEffect(() => {
      return () => {
        if (pendingSaveRef.current) {
          clearTimeout(pendingSaveRef.current);
        }
      };
    }, []);

    // Auto-focus the editor after mount
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const input = el.querySelector('.documint-input') as HTMLTextAreaElement;
          if (input) input.focus();
        });
      });
      return () => cancelAnimationFrame(raf);
    }, []);

    // ── Agent: Launch from comment thread ────────────────
    async function launchAgentFromThread(thread: CommentThread) {
      const threadId = thread.id;
      if (!threadId) return;

      const config = threadConfigs.get(threadId);
      const instructions = thread.comments[0]?.body || thread.quote;
      const anchor = {
        quote: thread.quote,
        prefix: thread.anchor.prefix || '',
        suffix: thread.anchor.suffix || '',
      };

      // Mark as launching
      setThreadConfigs(prev => {
        const next = new Map(prev);
        const existing = next.get(threadId);
        if (existing) next.set(threadId, { ...existing, launching: true });
        return next;
      });

      onSaveStatus('⚡ Launching agent...');
      await doSave();

      const result = await intentAPI.launchAgent(
        intentId,
        instructions,
        anchor,
        { repo: config?.repo, model: config?.model },
      );

      if (result.error) {
        onSaveStatus('✗ ' + result.error);
        setTimeout(() => onSaveStatus(''), 3000);
        setThreadConfigs(prev => {
          const next = new Map(prev);
          const existing = next.get(threadId);
          if (existing) next.set(threadId, { ...existing, launching: false });
          return next;
        });
        return;
      }

      const newAgent: AgentInfo = {
        agentId: result.agentId!,
        sessionId: result.sessionId!,
        threadId,
        selectedText: thread.quote.trim(),
        quote: thread.quote,
        prefix: thread.anchor.prefix || '',
        suffix: thread.anchor.suffix || '',
        status: 'running',
        summary: 'Starting...',
        instructions,
      };
      setRunningAgents(prev => [...prev, newAgent]);

      // Collapse config panel after launch
      setThreadConfigs(prev => {
        const next = new Map(prev);
        next.delete(threadId);
        return next;
      });

      onSaveStatus('⚡ Agent launched');
      setTimeout(() => onSaveStatus(''), 2000);
    }

    // ── Agent: IPC event listeners ──────────────────────
    useEffect(() => {
      intentAPI.onAgentStatusChanged((data) => {
        setRunningAgents(prev => prev.map(a =>
          a.agentId === data.agentId
            ? { ...a, status: data.status, summary: data.summary || a.summary }
            : a
        ));
      });

      intentAPI.onAgentApprovalNeeded((data) => {
        setApprovalRequest(data);
      });

      intentAPI.onAgentCompleted((data) => {
        setRunningAgents(prev => prev.map(a =>
          a.agentId === data.agentId
            ? { ...a, status: 'completed', summary: data.summary || 'Completed' }
            : a
        ));
      });
    }, []);

    // ── Agent: Flash animation timer ────────────────────
    useEffect(() => {
      const hasRunning = runningAgents.some(a => a.status === 'running' || a.status === 'waiting-approval');
      if (!hasRunning) return;

      const interval = setInterval(() => {
        setFlashTick(t => t + 1);
      }, 800);
      return () => clearInterval(interval);
    }, [runningAgents]);

    // ── Agent: Build content with comment threads ───────
    const contentWithAgents = useMemo(() => {
      if (runningAgents.length === 0) return content;

      const threads = runningAgents.map(agent => ({
        id: `agent-${agent.agentId}`,
        quote: agent.quote,
        anchor: {
          kind: 'text' as const,
          prefix: agent.prefix,
          suffix: agent.suffix,
        },
        metadata: { origin: 'agent-status', agentId: agent.agentId },
        comments: [{
          body: agent.status === 'completed' ? `✓ ${agent.summary}` :
                agent.status === 'failed' ? `✗ ${agent.summary}` :
                agent.status === 'waiting-approval' ? '⏳ Waiting for approval...' :
                `⚡ ${agent.summary}`,
          updatedAt: new Date().toISOString(),
        }],
        ...(agent.status === 'completed' || agent.status === 'failed' ? { resolvedAt: new Date().toISOString() } : {}),
      }));

      const stripped = content.replace(/\n*:::documint-comments\n[\s\S]*?\n:::\s*$/, '');
      const directive = `\n\n:::documint-comments\n${JSON.stringify(threads, null, 2)}\n:::`;
      return stripped + directive;
    }, [content, runningAgents, flashTick]);

    // ── Comment thread extension slots ──────────────────
    const commentThreadSlots: CommentThreadSlots = useMemo(() => ({
      onCreated: (thread: CommentThread, _threadIndex: number) => {
        if (pendingLaunchRef.current) {
          pendingLaunchRef.current = false;
          launchAgentFromThread(thread);
        }
      },

      renderCreateActions: ({ draft, createThread }) => {
        const hasDraft = draft.trim().length > 0;
        return (
          <button
            className="documint-leaf-action agent-create-launch"
            aria-label="Create comment and launch agent"
            disabled={!hasDraft}
            onClick={() => {
              if (!hasDraft) return;
              pendingLaunchRef.current = true;
              createThread();
            }}
            title="Create comment and launch agent"
            type="button"
          >
            ⚡
          </button>
        );
      },

      renderActions: ({ thread, isResolved }) => {
        const isAgentStatus = thread.metadata?.origin === 'agent-status';
        if (isAgentStatus || isResolved) return null;

        const threadId = thread.id;
        if (!threadId) return null;

        const agentForThread = runningAgents.find(a => a.threadId === threadId);
        if (agentForThread) {
          // Agent already running for this thread — show status indicator
          return (
            <button
              className="documint-leaf-action agent-thread-status"
              title={`Agent: ${agentForThread.summary}`}
              onClick={() => intentAPI.openAgentCli(agentForThread.agentId)}
              type="button"
            >
              {agentForThread.status === 'completed' ? '✓' :
               agentForThread.status === 'failed' ? '✗' : '⚡'}
            </button>
          );
        }

        const config = threadConfigs.get(threadId);
        return (
          <button
            className="documint-leaf-action agent-thread-launch"
            title="Launch agent on this thread"
            onClick={() => {
              if (config?.expanded) {
                // Toggle off
                setThreadConfigs(prev => {
                  const next = new Map(prev);
                  next.delete(threadId);
                  return next;
                });
              } else {
                // Toggle on — show config panel
                setThreadConfigs(prev => {
                  const next = new Map(prev);
                  next.set(threadId, {
                    repo: config?.repo || '',
                    model: config?.model || '',
                    expanded: true,
                    launching: false,
                  });
                  return next;
                });
              }
            }}
            type="button"
          >
            ⚡
          </button>
        );
      },

      renderFooter: ({ thread, isResolved }) => {
        const isAgentStatus = thread.metadata?.origin === 'agent-status';
        if (isAgentStatus || isResolved) return null;

        const threadId = thread.id;
        if (!threadId) return null;

        const config = threadConfigs.get(threadId);
        if (!config?.expanded) return null;

        return (
          <div className="agent-config-panel">
            <div className="agent-config-field">
              <label>Repository</label>
              <input
                type="text"
                placeholder="owner/repo (optional)"
                value={config.repo}
                onChange={(e) => {
                  const val = e.target.value;
                  setThreadConfigs(prev => {
                    const next = new Map(prev);
                    next.set(threadId, { ...config, repo: val });
                    return next;
                  });
                }}
              />
            </div>
            {models.length > 0 && (
              <div className="agent-config-field">
                <label>Model</label>
                <select
                  value={config.model}
                  onChange={(e) => {
                    const val = e.target.value;
                    setThreadConfigs(prev => {
                      const next = new Map(prev);
                      next.set(threadId, { ...config, model: val });
                      return next;
                    });
                  }}
                >
                  <option value="">Default</option>
                  {models.map(m => (
                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              className="agent-config-launch-btn"
              disabled={config.launching}
              onClick={() => launchAgentFromThread(thread)}
            >
              {config.launching ? '⚡ Launching...' : '⚡ Launch Agent'}
            </button>
          </div>
        );
      },
    }), [runningAgents, threadConfigs, models, intentId]); // eslint-disable-line react-hooks/exhaustive-deps

    const documintTheme = theme === 'dark' ? darkTheme : lightTheme;

    return (
      <div
        ref={containerRef}
        className={`documint-canvas-container${isDragging ? ' drag-over' : ''}`}
      >
        <Documint
          content={contentWithAgents}
          commentThreadSlots={commentThreadSlots}
          onContentChange={handleContentChange}
          onStateChange={handleStateChange}
          theme={documintTheme}
        />
        {/* Approval overlay */}
        {approvalRequest && (
          <div className="agent-approval-bar">
            <span className="agent-approval-text">
              ⚡ Agent needs permission: <strong>{approvalRequest.permissionKind}</strong>
            </span>
            <button
              className="agent-approval-btn approve"
              onClick={() => {
                intentAPI.approveAgent(approvalRequest.agentId, approvalRequest.requestId, true);
                setApprovalRequest(null);
              }}
            >
              Approve
            </button>
            <button
              className="agent-approval-btn deny"
              onClick={() => {
                intentAPI.approveAgent(approvalRequest.agentId, approvalRequest.requestId, false);
                setApprovalRequest(null);
              }}
            >
              Deny
            </button>
          </div>
        )}
      </div>
    );
  }
);
