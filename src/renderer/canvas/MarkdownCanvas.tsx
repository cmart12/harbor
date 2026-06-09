import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { MilkdownEditor, type MilkdownEditorHandle } from './editor/MilkdownEditor';
import type {
  CanvasUser,
  CanvasPresence,
  CanvasDecoration,
  CommentChange,
  UserMentionEvent,
  CommentTrigger,
} from './types';
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
  openCanvasWindow(target: { kind: string; id: string; title: string }): void;
  createPage(spaceId: string, pageName: string): Promise<{ success: boolean; page: string; error?: string }>;
  readPage(spaceId: string, pageName: string): Promise<{ content: string; error?: string }>;
  writePage(spaceId: string, pageName: string, content: string): Promise<{ success?: boolean; error?: string }>;
  closePage(spaceId: string, pageName: string, content: string): Promise<{ success?: boolean; error?: string }>;
  listPages(spaceId: string): Promise<{ pages: string[]; error?: string }>;
  openPageWindow(target: { kind: 'page'; spaceId: string; page: string; title: string }): void;
  openExternal(url: string): Promise<{ ok: true }>;
  openLink(spaceId: string, url: string): Promise<{ action: string; error?: string }>;
};

/** Route a whim:// resource click to the matching window opener. */
function openWhimResource(url: string): void {
  if (url.startsWith('whim://space/')) {
    const id = url.slice('whim://space/'.length);
    if (id) whimAPI.openCanvasWindow({ kind: 'space', id, title: '' });
    return;
  }
  if (url.startsWith('whim://page/')) {
    const parts = decodeURIComponent(url.slice('whim://page/'.length)).split('/');
    if (parts.length >= 2) {
      const [spaceId, ...rest] = parts;
      const page = rest.join('/');
      whimAPI.openPageWindow({ kind: 'page', spaceId, page, title: page });
    }
  }
}

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

export interface MarkdownCanvasProps {
  spaceId: string;
  initialContent: string;
  initialFrontmatter?: Record<string, unknown>;
  theme: 'light' | 'dark';
  personas?: AgentPersona[];
  agentPresence?: CanvasPresence[];
  decorations?: readonly CanvasDecoration[];
  onDirtyChange: (dirty: boolean) => void;
  onSaveStatus: (status: string) => void;
  onAgentMentioned?: (event: MentionEvent) => void;
  onInlineMention?: (handle: string, lineMarkdown: string, lineNumber: number) => void;
  onForkSelection?: (selectedText: string) => void;
  onExtractToPage?: (selectedText: string) => void;
}

export interface MarkdownCanvasHandle {
  saveNow(): Promise<void>;
  getContent(): string;
  getEditorMode(): EditorMode;
  toggleMode(): { mode: EditorMode; error?: string };
  updatePresence(presence: CanvasPresence[]): void;
  updatePersonas(personas: AgentPersona[]): void;
  updateDecorations(decorations: readonly CanvasDecoration[]): void;
  updateAgentUsers(users: CanvasUser[]): void;
  addCommentReply(threadId: string, body: string): void;
  replaceContent(content: string): void;
  appendLink(label: string, url: string): void;
  replaceText(search: string, replacement: string): void;
  getSelectedText(): string;
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
    return `${k}: ${JSON.stringify(v)}`;
  });
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** Try to parse frontmatter from raw markdown. Returns null if YAML is invalid. */
function tryParseFm(raw: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: raw };

  try {
    const fm: Record<string, unknown> = {};
    const yamlBlock = match[1];
    for (const line of yamlBlock.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
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

export const MarkdownCanvas = forwardRef<MarkdownCanvasHandle, MarkdownCanvasProps>(
  function MarkdownCanvas({ spaceId, initialContent, initialFrontmatter, theme, personas: initialPersonas, agentPresence: initialPresence, decorations: initialDecorations, onDirtyChange, onSaveStatus, onAgentMentioned, onInlineMention, onForkSelection, onExtractToPage }, ref) {
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
    const editorRef = useRef<MilkdownEditorHandle>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [personas, setPersonas] = useState<AgentPersona[]>(initialPersonas || []);
    const [presence, setPresence] = useState<CanvasPresence[]>(initialPresence || []);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [decorations, setDecorations] = useState<readonly CanvasDecoration[]>(initialDecorations || []);
    const [agentUsers, setAgentUsers] = useState<CanvasUser[]>([]);
    const [showLinkPicker, setShowLinkPicker] = useState(false);
    const [commentTrigger, setCommentTrigger] = useState<CommentTrigger>('caret');

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const val = await whimAPI.getSetting('comment_trigger');
          if (!cancelled) {
            setCommentTrigger(val === 'hover-or-caret' ? 'hover-or-caret' : 'caret');
          }
        } catch { /* keep default */ }
      })();
      return () => { cancelled = true; };
    }, []);

    contentRef.current = content;
    frontmatterRef.current = frontmatter;
    editorModeRef.current = editorMode;
    rawContentRef.current = rawContent;

    // Suppress noise from unused-for-now state until their plugins land (p3–p6).
    void presence; void agentUsers; void commentTrigger;
    void onAgentMentioned; void onInlineMention; void onForkSelection; void onExtractToPage;

    /** Build the full document string for saving. */
    const getFullContent = useCallback(() => {
      if (!hasFrontmatter) return contentRef.current;
      return serializeFm(frontmatterRef.current, contentRef.current);
    }, [hasFrontmatter]);

    // Merge persona users (for mention roster) with active agent users (for presence display)
    const users: CanvasUser[] = React.useMemo(
      () => [
        ...personas.map(p => ({ id: p.handle, username: p.handle })),
        ...agentUsers,
      ],
      [personas, agentUsers],
    );
    void users;

    const doSave = useCallback(async () => {
      if (savingRef.current) return;
      const fullContent = getFullContent();
      if (fullContent === lastSavedRef.current) return;

      savingRef.current = true;
      try {
        const result = await whimAPI.writeCanvas(spaceId, fullContent);
        const savedContent = (result as any)?.content ?? fullContent;
        lastSavedRef.current = savedContent;
        lastDiskContentRef.current = savedContent;
        if (savedContent !== fullContent) {
          const body = hasFrontmatter ? (tryParseFm(savedContent)?.body ?? savedContent) : savedContent;
          setContent(body);
          contentRef.current = body;
          if (editorModeRef.current === 'rendered') editorRef.current?.replaceAll(body);
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

    // Content change ORIGINATING in the editor (user typing). Does NOT write back
    // into the editor — only updates host state + schedules a save.
    const onEditorContentChanged = useCallback((newContent: string) => {
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

    // Content change ORIGINATING in the host (voice, drop, links, replies). Pushes
    // the new markdown INTO the editor and updates host state.
    const applyProgrammaticContent = useCallback((newContent: string) => {
      if (newContent === contentRef.current) return;
      setContent(newContent);
      contentRef.current = newContent;
      if (editorModeRef.current === 'rendered') {
        editorRef.current?.replaceAll(newContent);
      }
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

    useImperativeHandle(ref, () => ({
      saveNow,
      getContent: () => getFullContent(),
      getEditorMode: () => editorModeRef.current,
      toggleMode: () => handleToggleMode(),
      updatePresence: (nextPresence: CanvasPresence[]) => setPresence(nextPresence),
      updatePersonas: (nextPersonas: AgentPersona[]) => setPersonas(nextPersonas),
      updateDecorations: (nextDecorations: readonly CanvasDecoration[]) => setDecorations(nextDecorations),
      updateAgentUsers: (nextUsers: CanvasUser[]) => setAgentUsers(nextUsers),
      addCommentReply: (threadId: string, body: string) => {
        const current = contentRef.current;
        const updated = insertCommentReply(current, threadId, body);
        if (updated !== current) {
          applyProgrammaticContent(updated);
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
          editorRef.current?.replaceAll(newDiskContent);
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
        editorRef.current?.replaceAll(merged);

        const fullMerged = hasFrontmatter ? serializeFm(frontmatterRef.current, merged) : merged;

        if (fullMerged !== fullDisk) {
          onDirtyChange(true);
          scheduleSave();
        } else {
          lastSavedRef.current = fullMerged;
          onDirtyChange(false);
        }
      },
      appendLink: (label: string, url: string) => {
        const link = `[${label}](${url})`;
        const current = contentRef.current;
        const separator = current.endsWith('\n') || current === '' ? '' : '\n';
        applyProgrammaticContent(current + separator + link);
      },
      replaceText: (search: string, replacement: string) => {
        const current = contentRef.current;
        const idx = current.indexOf(search);
        if (idx === -1) return;
        const updated = current.slice(0, idx) + replacement + current.slice(idx + search.length);
        applyProgrammaticContent(updated);
      },
      getSelectedText: () => {
        if (editorModeRef.current === 'rendered') {
          const fromEditor = editorRef.current?.getSelectedText();
          if (fromEditor) return fromEditor;
        }
        const sel = window.getSelection();
        return sel ? sel.toString() : '';
      },
    }), [saveNow, applyProgrammaticContent, scheduleSave, hasFrontmatter, onDirtyChange, getFullContent, handleToggleMode]);

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
      applyProgrammaticContent(current + separator + link);
    }, [applyProgrammaticContent]);

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
      applyProgrammaticContent(current + separator + markdownRef);
    }

    const handleRecordingStart = useCallback(() => {
      const current = contentRef.current;
      const placeholder = VOICE_PLACEHOLDER;

      const separator = current.endsWith('\n') ? '\n' : '\n\n';
      applyProgrammaticContent(current + separator + placeholder + '\n');
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleRecordingComplete = useCallback(async (result: VoiceRecordingResult) => {
      setIsTranscribing(true);
      onSaveStatus('🎤 Saving clip…');

      try {
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

        let transcription = '';
        try {
          onSaveStatus('✨ Transcribing…');
          const text = await whimAPI.transcribe(Array.from(result.float32Data));
          transcription = text?.trim() || '';
        } catch (err) {
          console.error('[canvas-voice] Transcription failed:', err);
          transcription = '_Transcription failed_';
        }

        const block = transcription
          ? `${audioRef}\n\n${transcription}`
          : audioRef;

        const current = contentRef.current;
        const bareIdx = current.indexOf(VOICE_PLACEHOLDER);
        if (bareIdx >= 0) {
          let lineStart = current.lastIndexOf('\n', bareIdx - 1);
          lineStart = lineStart < 0 ? 0 : lineStart + 1;
          let lineEnd = current.indexOf('\n', bareIdx + VOICE_PLACEHOLDER.length);
          if (lineEnd < 0) lineEnd = current.length;
          else lineEnd += 1;

          const before = current.slice(0, lineStart);
          const after = current.slice(lineEnd);
          const pre = before.length === 0 || before.endsWith('\n') ? '' : '\n';
          const post = after.length === 0 || after.startsWith('\n') ? '' : '\n';
          applyProgrammaticContent(before + pre + block + '\n' + post + after);
        } else {
          const separator = current.endsWith('\n') ? '\n' : '\n\n';
          applyProgrammaticContent(current + separator + block + '\n');
        }

        onSaveStatus('✓ Voice clip added');
        setTimeout(() => onSaveStatus(''), 2000);
      } catch (err: any) {
        console.error('[canvas-voice] Error:', err);
        const current = contentRef.current;
        const bareIdx = current.indexOf(VOICE_PLACEHOLDER);
        if (bareIdx >= 0) {
          let lineStart = current.lastIndexOf('\n', bareIdx - 1);
          lineStart = lineStart < 0 ? 0 : lineStart;
          let lineEnd = current.indexOf('\n', bareIdx + VOICE_PLACEHOLDER.length);
          if (lineEnd < 0) lineEnd = current.length;
          else lineEnd += 1;
          applyProgrammaticContent(current.slice(0, lineStart) + current.slice(lineEnd));
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
      if (editorMode !== 'rendered') return;
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          editorRef.current?.focus();
        });
      });
      return () => cancelAnimationFrame(raf);
    }, [editorMode]);

    return (
      <div
        ref={containerRef}
        className={`markdown-canvas-container${isDragging ? ' drag-over' : ''} md-theme-${theme}`}
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
            <div className="markdown-editor-wrap">
              <MilkdownEditor
                ref={editorRef}
                initialContent={content}
                theme={theme}
                onContentChanged={onEditorContentChanged}
                decorations={decorations}
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

// Handlers reserved for the comment/mention plugins (p3–p4). Keeping the shapes
// here documents the contract the plugins will fulfill.
export type { CommentChange, UserMentionEvent };
