import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  Documint,
  lightTheme,
  darkTheme,
  type DocumintState,
} from 'documint';

declare const intentAPI: {
  writeCanvas(intentId: string, content: string): Promise<void>;
  pasteFile(intentId: string, filename: string, dataArray: number[]): Promise<{ error?: string; filename?: string; relativePath?: string }>;
  launchAgent(intentId: string, selectedText: string, anchor: any): Promise<{ agentId?: string; sessionId?: string; error?: string }>;
  approveAgent(agentId: string, requestId: string, approved: boolean): Promise<void>;
  openAgentCli(agentId: string): Promise<{ error?: string }>;
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

    // Agent tracking
    interface AgentInfo {
      agentId: string;
      sessionId: string;
      selectedText: string;
      quote: string;
      prefix: string;
      suffix: string;
      status: string;
      summary: string;
      instructions: string;
    }
    const [runningAgents, setRunningAgents] = useState<AgentInfo[]>([]);
    const [approvalRequest, setApprovalRequest] = useState<{ agentId: string; requestId: string; permissionKind: string } | null>(null);
    const [flashTick, setFlashTick] = useState(0);

    // Track comment threads to detect new ones (for "Run Agent" flow)
    const prevCommentCountRef = useRef(0);
    const [pendingAgentComment, setPendingAgentComment] = useState<{
      quote: string;
      prefix: string;
      suffix: string;
      instructions: string;
      threadIndex: number;
    } | null>(null);

    contentRef.current = content;

    const isDirty = content !== lastSavedRef.current;

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

    // ── Agent: Detect new comment threads ─────────────────
    // When onContentChange fires with a new comment thread, we show the "Run Agent" option
    const handleContentChange = useCallback((newContent: string) => {
      // Strip agent comment directive (we inject it ourselves for decoration)
      const stripped = newContent.replace(/\n*:::documint-comments\n[\s\S]*?\n:::\s*$/, '');

      // Detect new user-created comment threads in the raw content
      const commentMatch = newContent.match(/:::documint-comments\n([\s\S]*?)\n:::/);
      if (commentMatch) {
        try {
          const threads = JSON.parse(commentMatch[1]);
          const agentThreadCount = runningAgents.length;
          const userThreadCount = threads.length - agentThreadCount;
          if (userThreadCount > prevCommentCountRef.current) {
            // A new comment thread was created by the user
            const newThread = threads[threads.length - 1];
            if (newThread && newThread.quote && newThread.comments?.[0]?.body) {
              const canonical = stateRef.current?.canonicalContent || stripped;
              const quoteIdx = canonical.indexOf(newThread.quote);
              const prefix = quoteIdx > 0 ? canonical.slice(Math.max(0, quoteIdx - 24), quoteIdx) : '';
              const suffix = quoteIdx >= 0 ? canonical.slice(quoteIdx + newThread.quote.length, quoteIdx + newThread.quote.length + 24) : '';

              setPendingAgentComment({
                quote: newThread.quote,
                prefix,
                suffix,
                instructions: newThread.comments[0].body,
                threadIndex: threads.length - 1,
              });
            }
          }
          prevCommentCountRef.current = userThreadCount;
        } catch {
          // ignore parse errors
        }
      }

      if (stripped === contentRef.current) return;
      setContent(stripped);
      const dirty = stripped !== lastSavedRef.current;
      onDirtyChange(dirty);
      if (dirty) {
        onSaveStatus('');
        scheduleSave();
      }
    }, [onDirtyChange, onSaveStatus, scheduleSave, runningAgents.length]);

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

      // Try to insert at cursor position using canonicalContent offsets
      if (state && state.canonicalContent === current && state.selectionTo >= 0) {
        const pos = state.selectionTo;
        const before = current.slice(0, pos);
        const after = current.slice(pos);
        handleContentChange(before + markdownRef + after);
      } else {
        // Fallback: append to end
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

    // ── Agent: Launch from comment ────────────────────────
    async function launchAgentFromComment() {
      if (!pendingAgentComment) return;

      const { quote, prefix, suffix, instructions } = pendingAgentComment;
      const anchor = { quote, prefix, suffix };

      onSaveStatus('⚡ Launching agent...');
      setPendingAgentComment(null);

      // Auto-save first
      await doSave();

      const result = await intentAPI.launchAgent(intentId, instructions, anchor);

      if (result.error) {
        onSaveStatus('✗ ' + result.error);
        setTimeout(() => onSaveStatus(''), 3000);
        return;
      }

      const newAgent: AgentInfo = {
        agentId: result.agentId!,
        sessionId: result.sessionId!,
        selectedText: quote.trim(),
        quote,
        prefix,
        suffix,
        status: 'running',
        summary: 'Starting...',
        instructions,
      };
      setRunningAgents(prev => [...prev, newAgent]);
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

    // ── Agent: Double-click to open CLI ─────────────────
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const handler = (e: MouseEvent) => {
        const state = stateRef.current;
        if (!state || state.activeCommentThreadIndex === null) return;

        // Find if this comment thread corresponds to a running agent
        const agentIndex = state.activeCommentThreadIndex;
        const agent = runningAgents[agentIndex];
        if (agent && (agent.status === 'running' || agent.status === 'waiting-approval')) {
          intentAPI.openAgentCli(agent.agentId);
        }
      };

      el.addEventListener('dblclick', handler);
      return () => el.removeEventListener('dblclick', handler);
    }, [runningAgents]);

    // ── Agent: Build content with comment threads ───────
    // Inject agent comment threads into the content as a documint-comments directive
    const contentWithAgents = React.useMemo(() => {
      if (runningAgents.length === 0) return content;

      const threads = runningAgents.map(agent => ({
        quote: agent.quote,
        anchor: {
          kind: 'text' as const,
          prefix: agent.prefix,
          suffix: agent.suffix,
        },
        comments: [{
          body: agent.status === 'completed' ? `✓ ${agent.summary}` :
                agent.status === 'failed' ? `✗ ${agent.summary}` :
                agent.status === 'waiting-approval' ? '⏳ Waiting for approval...' :
                `⚡ ${agent.summary}`,
          updatedAt: new Date().toISOString(),
        }],
        // Flash: toggle resolved state for running agents
        ...(agent.status === 'running' && flashTick % 2 === 0 ? {} : {}),
        ...(agent.status === 'completed' || agent.status === 'failed' ? { resolvedAt: new Date().toISOString() } : {}),
      }));

      // Strip any existing comment directive and append our agent threads
      const stripped = content.replace(/\n*:::documint-comments\n[\s\S]*?\n:::\s*$/, '');
      const directive = `\n\n:::documint-comments\n${JSON.stringify(threads, null, 2)}\n:::`;
      return stripped + directive;
    }, [content, runningAgents, flashTick]);

    const documintTheme = theme === 'dark' ? darkTheme : lightTheme;

    return (
      <div
        ref={containerRef}
        className={`documint-canvas-container${isDragging ? ' drag-over' : ''}`}
      >
        <Documint
          content={contentWithAgents}
          onContentChange={handleContentChange}
          onStateChange={handleStateChange}
          theme={documintTheme}
        />
        {/* Run Agent overlay — appears when user creates a comment */}
        {pendingAgentComment && (
          <div className="agent-launch-bar">
            <span className="agent-launch-text">
              ⚡ Run agent on: &ldquo;{pendingAgentComment.quote.length > 40
                ? pendingAgentComment.quote.slice(0, 37) + '...'
                : pendingAgentComment.quote}&rdquo;
            </span>
            <button
              className="agent-launch-btn run"
              onClick={() => launchAgentFromComment()}
            >
              Run Agent
            </button>
            <button
              className="agent-launch-btn dismiss"
              onClick={() => setPendingAgentComment(null)}
            >
              ✕
            </button>
          </div>
        )}
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
