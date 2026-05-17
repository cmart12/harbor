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
  type DocumentUser,
  type DocumentPresence,
  type CommentChange,
  type DocumintStorage,
  type UserMentionEvent,
  type DocumintActions,
  type DocumintDecoration,
} from 'documint';
import { GitFork } from 'lucide-react';
import { FrontmatterEditor } from './FrontmatterEditor';
import { VoiceRecorderButton, type VoiceRecordingResult } from './VoiceRecorderButton';
import { SpaceLinkPicker, type SpaceResult } from './SpaceLinkPicker';
import { merge3 } from '../../shared/text-merge';

declare const whimAPI: {
  writeCanvas(spaceId: string, content: string): Promise<void>;
  pasteFile(spaceId: string, filename: string, dataArray: number[]): Promise<{ error?: string; filename?: string; relativePath?: string }>;
  readFile(spaceId: string, relativePath: string): Promise<{ data?: number[]; mimeType?: string; error?: string }>;
  getSetting(key: string): Promise<string | null>;
  transcribe(audioData: number[]): Promise<string>;
  list(): Promise<Array<{ id: string; description: string; status: string }>>;
  searchSpaces(query: string): Promise<Array<{ id: string; description: string; status: string }>>;
};

export interface AgentPersona {
  id: string;
  handle: string;
  instructions: string;
  model: string;
  emoji?: string;
  cliRuntime?: string;
}

export interface MentionEvent {
  handles: string[];
  commentBody: string;
  quote: string;
  anchor: { prefix?: string; suffix?: string };
  threadId: string | null;
}

export interface DocumintCanvasProps {
  spaceId: string;
  initialContent: string;
  initialFrontmatter?: Record<string, unknown>;
  theme: 'light' | 'dark';
  personas?: AgentPersona[];
  agentPresence?: DocumentPresence[];
  decorations?: readonly DocumintDecoration[];
  onDirtyChange: (dirty: boolean) => void;
  onSaveStatus: (status: string) => void;
  onAgentMentioned?: (event: MentionEvent) => void;
  onInlineMention?: (handle: string, lineMarkdown: string, lineNumber: number) => void;
  onForkSelection?: (selectedText: string) => void;
}

export interface DocumintCanvasHandle {
  saveNow(): Promise<void>;
  getContent(): string;
  getEditorMode(): EditorMode;
  toggleMode(): { mode: EditorMode; error?: string };
  updatePresence(presence: DocumentPresence[]): void;
  updatePersonas(personas: AgentPersona[]): void;
  updateDecorations(decorations: readonly DocumintDecoration[]): void;
  updateAgentUsers(users: DocumentUser[]): void;
  addCommentReply(threadId: string, body: string): void;
  replaceContent(content: string): void;
}

const AUTOSAVE_DELAY_MS = 2000;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const VOICE_PLACEHOLDER = '🎤 *[Recording transcription…]*';

type EditorMode = 'rendered' | 'raw';

/** Serialize frontmatter + body into a markdown string with YAML block. */
function serializeFm(fm: Record<string, unknown>, body: string): string {
  const keys = Object.keys(fm).filter(k => fm[k] !== undefined && fm[k] !== null);
  if (keys.length === 0) return body;

  const lines = keys.map(k => {
    const v = fm[k];
    if (typeof v === 'string') return `${k}: ${v}`;
    // Preserve non-string values as YAML-compatible representation
    return `${k}: ${JSON.stringify(v)}`;
  });
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** Try to parse frontmatter from raw markdown. Returns null if YAML is invalid. */
function tryParseFm(raw: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: raw };

  try {
    // Simple YAML key: value parsing for known scalar fields
    const fm: Record<string, unknown> = {};
    const yamlBlock = match[1];
    for (const line of yamlBlock.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        // Try to parse JSON values (arrays, booleans, numbers)
        try {
          fm[key] = JSON.parse(value);
        } catch {
          fm[key] = value;
        }
      }
    }
    return { frontmatter: fm, body: match[2] };
  } catch {
    return null;
  }
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
  function DocumintCanvas({ spaceId, initialContent, initialFrontmatter, theme, personas: initialPersonas, agentPresence: initialPresence, decorations: initialDecorations, onDirtyChange, onSaveStatus, onAgentMentioned, onInlineMention, onForkSelection }, ref) {
    const hasFrontmatter = initialFrontmatter !== undefined;
    const [content, setContent] = useState(initialContent);
    const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>(initialFrontmatter ?? {});
    const [editorMode, setEditorMode] = useState<EditorMode>('rendered');
    const [rawContent, setRawContent] = useState('');
    const [parseError, setParseError] = useState<string | null>(null);
    const lastSavedRef = useRef(hasFrontmatter ? serializeFm(initialFrontmatter!, initialContent) : initialContent);
    const lastDiskContentRef = useRef(hasFrontmatter ? serializeFm(initialFrontmatter!, initialContent) : initialContent);
    const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savingRef = useRef(false);
    const contentRef = useRef(content);
    const frontmatterRef = useRef(frontmatter);
    const editorModeRef = useRef<EditorMode>(editorMode);
    const rawContentRef = useRef(rawContent);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [personas, setPersonas] = useState<AgentPersona[]>(initialPersonas || []);
    const [presence, setPresence] = useState<DocumentPresence[]>(initialPresence || []);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [decorations, setDecorations] = useState<readonly DocumintDecoration[]>(initialDecorations || []);
    const [agentUsers, setAgentUsers] = useState<DocumentUser[]>([]);
    const [showLinkPicker, setShowLinkPicker] = useState(false);

    contentRef.current = content;
    frontmatterRef.current = frontmatter;
    editorModeRef.current = editorMode;
    rawContentRef.current = rawContent;

    /** Build the full document string for saving. */
    const getFullContent = useCallback(() => {
      if (!hasFrontmatter) return contentRef.current;
      return serializeFm(frontmatterRef.current, contentRef.current);
    }, [hasFrontmatter]);

    // Merge persona users (for mention roster) with active agent users (for presence display)
    const users: DocumentUser[] = React.useMemo(
      () => [
        ...personas.map(p => ({ id: p.handle, username: p.handle })),
        ...agentUsers,
      ],
      [personas, agentUsers],
    );

    // Documint storage: read/write files from the space's folder
    const storage: DocumintStorage = React.useMemo(() => ({
      async readFile(filePath: string): Promise<Blob | null> {
        try {
          const result = await whimAPI.readFile(spaceId, filePath);
          if (result.error || !result.data) return null;
          const bytes = new Uint8Array(result.data);
          return new Blob([bytes], { type: result.mimeType || 'application/octet-stream' });
        } catch {
          return null;
        }
      },
      async writeFile(file: File): Promise<string> {
        const buffer = await file.arrayBuffer();
        const dataArray = Array.from(new Uint8Array(buffer));
        const result = await whimAPI.pasteFile(spaceId, file.name, dataArray);
        if (result.error) throw new Error(result.error);
        return result.relativePath!;
      },
    }), [spaceId]);

    const doSave = useCallback(async () => {
      if (savingRef.current) return;
      const fullContent = getFullContent();
      if (fullContent === lastSavedRef.current) return;

      savingRef.current = true;
      try {
        const result = await whimAPI.writeCanvas(spaceId, fullContent);
        // If the main process merged with disk changes, update to merged content
        const savedContent = (result as any)?.content ?? fullContent;
        lastSavedRef.current = savedContent;
        lastDiskContentRef.current = savedContent;
        if (savedContent !== fullContent) {
          // Main process merged — update editor with merged result
          const body = hasFrontmatter ? (tryParseFm(savedContent)?.body ?? savedContent) : savedContent;
          setContent(body);
          contentRef.current = body;
        }
        onDirtyChange(getFullContent() !== lastSavedRef.current);
        onSaveStatus('✓');
        setTimeout(() => onSaveStatus(''), 1500);
      } catch {
        onSaveStatus('✗ save failed');
        setTimeout(() => onSaveStatus(''), 3000);
      } finally {
        savingRef.current = false;
      }
    }, [spaceId, onDirtyChange, onSaveStatus, getFullContent, hasFrontmatter]);

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

    const handleContentChange = useCallback((newContent: string) => {
      if (newContent === contentRef.current) return;
      setContent(newContent);
      contentRef.current = newContent;
      const fullContent = hasFrontmatter ? serializeFm(frontmatterRef.current, newContent) : newContent;
      const dirty = fullContent !== lastSavedRef.current;
      onDirtyChange(dirty);
      if (dirty) {
        onSaveStatus('');
        scheduleSave();
      }
    }, [onDirtyChange, onSaveStatus, scheduleSave, hasFrontmatter]);

    const handleFrontmatterChange = useCallback((updated: Record<string, unknown>) => {
      setFrontmatter(updated);
      frontmatterRef.current = updated;
      const dirty = serializeFm(updated, contentRef.current) !== lastSavedRef.current;
      onDirtyChange(dirty);
      if (dirty) {
        onSaveStatus('');
        scheduleSave();
      }
    }, [onDirtyChange, onSaveStatus, scheduleSave]);

    const handleToggleMode = useCallback((): { mode: EditorMode; error?: string } => {
      if (editorModeRef.current === 'rendered') {
        const full = getFullContent();
        setRawContent(full);
        rawContentRef.current = full;
        setParseError(null);
        setEditorMode('raw');
        editorModeRef.current = 'raw';
        return { mode: 'raw' };
      } else {
        if (hasFrontmatter) {
          const parsed = tryParseFm(rawContentRef.current);
          if (!parsed) {
            const err = 'Invalid YAML frontmatter. Fix the syntax before switching to rendered view.';
            setParseError(err);
            return { mode: 'raw', error: err };
          }
          setFrontmatter(parsed.frontmatter);
          frontmatterRef.current = parsed.frontmatter;
          setContent(parsed.body);
          contentRef.current = parsed.body;
        } else {
          setContent(rawContentRef.current);
          contentRef.current = rawContentRef.current;
        }
        setParseError(null);
        setEditorMode('rendered');
        editorModeRef.current = 'rendered';
        return { mode: 'rendered' };
      }
    }, [hasFrontmatter, getFullContent]);

    const handleRawContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newRaw = e.target.value;
      setRawContent(newRaw);
      rawContentRef.current = newRaw;
      setParseError(null);
      const dirty = newRaw !== lastSavedRef.current;
      onDirtyChange(dirty);
      if (dirty) {
        onSaveStatus('');
        // For raw mode, update refs so save works correctly
        if (hasFrontmatter) {
          const parsed = tryParseFm(newRaw);
          if (parsed) {
            contentRef.current = parsed.body;
            frontmatterRef.current = parsed.frontmatter;
          }
        } else {
          contentRef.current = newRaw;
        }
        scheduleSave();
      }
    }, [onDirtyChange, onSaveStatus, scheduleSave, hasFrontmatter]);

    const handleCommentChanged = useCallback((event: CommentChange) => {
      if (!onAgentMentioned) return;
      if (event.kind === 'deleted') return;
      if (event.mentionedUserIds.length === 0) return;

      // mentionedUserIds are handles (we use handle as DocumentUser.id)
      const handles = event.mentionedUserIds
        .filter(h => personas.some(p => p.handle === h));
      if (handles.length === 0) return;

      onAgentMentioned({
        handles,
        commentBody: event.comment.body,
        quote: event.thread.quote,
        anchor: event.thread.anchor,
        threadId: event.thread.id ?? null,
      });
    }, [onAgentMentioned, personas]);

    // Inline @-mention handler — dedupe by userId+lineNumber to prevent duplicate launches
    const recentInlineMentions = useRef(new Set<string>());
    const handleUserMentioned = useCallback((event: UserMentionEvent) => {
      if (!onInlineMention) return;

      // Check if this userId matches a known persona
      const matched = personas.some(p => p.handle === event.userId);
      if (!matched) return;

      // Dedupe: skip if we already fired for this mention recently
      const key = `${event.userId}:${event.lineNumber}:${event.lineMarkdown}`;
      if (recentInlineMentions.current.has(key)) return;
      recentInlineMentions.current.add(key);
      setTimeout(() => recentInlineMentions.current.delete(key), 5000);

      onInlineMention(event.userId, event.lineMarkdown, event.lineNumber);
    }, [onInlineMention, personas]);

    // Selection actions (Fork to new space)
    const actions: DocumintActions | undefined = React.useMemo(() => {
      if (!onForkSelection) return undefined;
      return {
        selection: {
          icon: GitFork,
          label: 'Fork to new space',
          onClick: onForkSelection,
        },
      };
    }, [onForkSelection]);

    useImperativeHandle(ref, () => ({
      saveNow,
      getContent: () => getFullContent(),
      getEditorMode: () => editorModeRef.current,
      toggleMode: () => handleToggleMode(),
      updatePresence: (nextPresence: DocumentPresence[]) => setPresence(nextPresence),
      updatePersonas: (nextPersonas: AgentPersona[]) => setPersonas(nextPersonas),
      updateDecorations: (nextDecorations: readonly DocumintDecoration[]) => setDecorations(nextDecorations),
      updateAgentUsers: (nextUsers: DocumentUser[]) => setAgentUsers(nextUsers),
      addCommentReply: (threadId: string, body: string) => {
        const current = contentRef.current;
        const updated = insertCommentReply(current, threadId, body);
        if (updated !== current) {
          handleContentChange(updated);
        }
      },
      replaceContent: (newDiskContent: string) => {
        // In raw mode, fall back to wholesale replace (no merge for textarea)
        if (editorModeRef.current === 'raw') {
          if (pendingSaveRef.current) {
            clearTimeout(pendingSaveRef.current);
            pendingSaveRef.current = null;
          }
          setRawContent(hasFrontmatter ? serializeFm(frontmatterRef.current, newDiskContent) : newDiskContent);
          rawContentRef.current = hasFrontmatter ? serializeFm(frontmatterRef.current, newDiskContent) : newDiskContent;
          setContent(newDiskContent);
          contentRef.current = newDiskContent;
          const fullContent = hasFrontmatter ? serializeFm(frontmatterRef.current, newDiskContent) : newDiskContent;
          lastSavedRef.current = fullContent;
          lastDiskContentRef.current = fullContent;
          onDirtyChange(false);
          return;
        }

        const currentContent = contentRef.current;
        const base = lastDiskContentRef.current;

        // Always update our record of what's on disk
        const fullDisk = hasFrontmatter ? serializeFm(frontmatterRef.current, newDiskContent) : newDiskContent;
        lastDiskContentRef.current = fullDisk;

        // Fast path: no local changes since last disk sync — simple replace
        const currentFull = hasFrontmatter ? serializeFm(frontmatterRef.current, currentContent) : currentContent;
        if (currentFull === base) {
          if (pendingSaveRef.current) {
            clearTimeout(pendingSaveRef.current);
            pendingSaveRef.current = null;
          }
          setContent(newDiskContent);
          contentRef.current = newDiskContent;
          lastSavedRef.current = fullDisk;
          onDirtyChange(false);
          return;
        }

        // Merge path: user has local edits — three-way merge
        const baseBody = hasFrontmatter ? (tryParseFm(base)?.body ?? base) : base;
        const { merged } = merge3(baseBody, currentContent, newDiskContent);

        if (pendingSaveRef.current) {
          clearTimeout(pendingSaveRef.current);
          pendingSaveRef.current = null;
        }

        setContent(merged);
        contentRef.current = merged;

        // Do NOT update lastSavedRef here — the merged content hasn't been
        // persisted yet.  doSave() compares getFullContent() with lastSavedRef
        // and would exit early if they matched.  We leave lastSavedRef as-is
        // so the upcoming save will detect the diff and write to disk.
        const fullMerged = hasFrontmatter ? serializeFm(frontmatterRef.current, merged) : merged;

        if (fullMerged !== fullDisk) {
          onDirtyChange(true);
          scheduleSave();
        } else {
          // Merged result matches disk — no save needed, update refs
          lastSavedRef.current = fullMerged;
          onDirtyChange(false);
        }
      },
    }), [saveNow, handleContentChange, scheduleSave, hasFrontmatter, onDirtyChange]);

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

    // Cmd+P handler — open space link picker
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
          e.preventDefault();
          setShowLinkPicker(prev => !prev);
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, []);

    const handleLinkPickerSelect = useCallback((space: SpaceResult) => {
      setShowLinkPicker(false);
      const link = `[${space.description || 'Untitled'}](whim://space/${space.id})`;
      const current = contentRef.current;
      const separator = current.endsWith('\n') || current === '' ? '' : '\n';
      handleContentChange(current + separator + link);
    }, [handleContentChange]);

    // File drag-and-drop handler
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

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
            const result = await whimAPI.pasteFile(spaceId, file.name, dataArray);

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

      el.addEventListener('dragover', handleDragOver);
      el.addEventListener('dragleave', handleDragLeave);
      el.addEventListener('drop', handleDrop);

      return () => {
        el.removeEventListener('dragover', handleDragOver);
        el.removeEventListener('dragleave', handleDragLeave);
        el.removeEventListener('drop', handleDrop);
      };
    }, [spaceId, onSaveStatus]); // eslint-disable-line react-hooks/exhaustive-deps

    function insertAttachment(markdownRef: string) {
      const current = contentRef.current;
      const separator = current.endsWith('\n') ? '' : '\n';
      handleContentChange(current + separator + markdownRef);
    }

    const handleRecordingStart = useCallback(() => {
      const current = contentRef.current;
      const placeholder = VOICE_PLACEHOLDER;

      const separator = current.endsWith('\n') ? '\n' : '\n\n';
      handleContentChange(current + separator + placeholder + '\n');
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleRecordingComplete = useCallback(async (result: VoiceRecordingResult) => {
      setIsTranscribing(true);
      onSaveStatus('🎤 Saving clip…');

      try {
        // Always save the audio file first
        const timestamp = Date.now();
        const filename = `voice-${timestamp}.webm`;
        const buffer = await result.audioBlob.arrayBuffer();
        const dataArray = Array.from(new Uint8Array(buffer));
        const pasteResult = await whimAPI.pasteFile(spaceId, filename, dataArray);

        if (pasteResult.error) {
          onSaveStatus('✗ Failed to save audio');
          setTimeout(() => onSaveStatus(''), 3000);
          return;
        }

        const audioRef = `[🎵 ${pasteResult.filename}](${pasteResult.relativePath})`;

        // Now transcribe
        let transcription = '';
        try {
          onSaveStatus('✨ Transcribing…');
          const text = await whimAPI.transcribe(Array.from(result.float32Data));
          transcription = text?.trim() || '';
        } catch (err) {
          console.error('[canvas-voice] Transcription failed:', err);
          transcription = '_Transcription failed_';
        }

        // Build the markdown block to insert
        const block = transcription
          ? `${audioRef}\n\n${transcription}`
          : audioRef;

        // Replace the placeholder line with the final content.
        // The placeholder is always on its own line(s).
        const current = contentRef.current;
        const bareIdx = current.indexOf(VOICE_PLACEHOLDER);
        if (bareIdx >= 0) {
          // Find the full line containing the placeholder
          let lineStart = current.lastIndexOf('\n', bareIdx - 1);
          lineStart = lineStart < 0 ? 0 : lineStart + 1;
          let lineEnd = current.indexOf('\n', bareIdx + VOICE_PLACEHOLDER.length);
          if (lineEnd < 0) lineEnd = current.length;
          else lineEnd += 1; // include the newline

          const before = current.slice(0, lineStart);
          const after = current.slice(lineEnd);
          // Ensure the block sits on its own lines
          const pre = before.length === 0 || before.endsWith('\n') ? '' : '\n';
          const post = after.length === 0 || after.startsWith('\n') ? '' : '\n';
          handleContentChange(before + pre + block + '\n' + post + after);
        } else {
          // Placeholder was removed — append at end as a new block
          const separator = current.endsWith('\n') ? '\n' : '\n\n';
          handleContentChange(current + separator + block + '\n');
        }

        onSaveStatus('✓ Voice clip added');
        setTimeout(() => onSaveStatus(''), 2000);
      } catch (err: any) {
        console.error('[canvas-voice] Error:', err);
        // Clean up placeholder on failure
        const current = contentRef.current;
        const bareIdx = current.indexOf(VOICE_PLACEHOLDER);
        if (bareIdx >= 0) {
          let lineStart = current.lastIndexOf('\n', bareIdx - 1);
          lineStart = lineStart < 0 ? 0 : lineStart;
          let lineEnd = current.indexOf('\n', bareIdx + VOICE_PLACEHOLDER.length);
          if (lineEnd < 0) lineEnd = current.length;
          else lineEnd += 1;
          handleContentChange(current.slice(0, lineStart) + current.slice(lineEnd));
        }
        onSaveStatus('✗ Voice recording failed');
        setTimeout(() => onSaveStatus(''), 3000);
      } finally {
        setIsTranscribing(false);
      }
    }, [spaceId, onSaveStatus]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleVoiceError = useCallback((message: string) => {
      onSaveStatus(`✗ ${message}`);
      setTimeout(() => onSaveStatus(''), 3000);
    }, [onSaveStatus]);

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

    const documintTheme = theme === 'dark'
      ? { ...darkTheme, background: '#1c1c20', leafBackground: '#1c1c20', selectionHandleBackground: '#1c1c20', dividerRule: '#3a3a40' }
      : lightTheme;

    return (
      <div
        ref={containerRef}
        className={`documint-canvas-container${isDragging ? ' drag-over' : ''}`}
      >
        {parseError && (
          <div className="frontmatter-parse-error">{parseError}</div>
        )}
        {editorMode === 'rendered' ? (
          <>
            {hasFrontmatter && (
              <FrontmatterEditor
                frontmatter={frontmatter}
                onChange={handleFrontmatterChange}
              />
            )}
            <div className="documint-editor-wrap">
              <Documint
                content={content}
                users={users}
                storage={storage}
                actions={actions}
                decorations={decorations}
                onContentChanged={handleContentChange}
                onCommentChanged={handleCommentChanged}
                onUserMentioned={handleUserMentioned}
                presence={presence}
                theme={documintTheme}
              />
              {isTranscribing && (
                <div className="canvas-voice-transcribing-bar">
                  <span className="canvas-voice-transcribing-spinner" />
                  <span>Transcribing…</span>
                </div>
              )}
              <VoiceRecorderButton
                theme={theme}
                onRecordingComplete={handleRecordingComplete}
                onRecordingStart={handleRecordingStart}
                onError={handleVoiceError}
                disabled={isTranscribing}
              />
            </div>
          </>
        ) : (
          <textarea
            className="canvas-raw-editor"
            value={rawContent}
            onChange={handleRawContentChange}
            spellCheck={false}
          />
        )}
        {showLinkPicker && (
          <SpaceLinkPicker
            onSelect={handleLinkPickerSelect}
            onDismiss={() => setShowLinkPicker(false)}
          />
        )}
      </div>
    );
  }
);

const COMMENTS_START = ':::documint-comments';
const COMMENTS_END = ':::';

function insertCommentReply(content: string, threadId: string, body: string): string {
  const startIdx = content.indexOf(COMMENTS_START);
  if (startIdx < 0) return content;

  const jsonStart = startIdx + COMMENTS_START.length;
  const endIdx = content.indexOf(COMMENTS_END, jsonStart);
  if (endIdx < 0) return content;

  const jsonStr = content.slice(jsonStart, endIdx).trim();
  try {
    const threads = JSON.parse(jsonStr);
    if (!Array.isArray(threads)) return content;

    const thread = threads.find((t: any) => t.id === threadId);
    if (!thread || !Array.isArray(thread.comments)) return content;

    thread.comments.push({
      body,
      updatedAt: new Date().toISOString(),
    });

    const newJson = JSON.stringify(threads, null, 2);
    return content.slice(0, jsonStart) + '\n' + newJson + '\n' + content.slice(endIdx);
  } catch {
    return content;
  }
}
