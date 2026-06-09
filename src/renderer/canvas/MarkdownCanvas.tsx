import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { MilkdownEditor, type MilkdownEditorHandle } from './editor/MilkdownEditor';
import type {
  CanvasUser,
  CanvasPresence,
  CanvasDecoration,
  CommentThread,
  CommentTrigger,
} from './types';
import { splitComments, joinComments, extractMentions, newThreadId } from './editor/comments';
import { SelectionToolbar, CommentComposer, CommentPopover } from './editor/CommentUI';
import { MentionPopup, type MentionCandidate } from './editor/MentionUI';
import type { Rect, SelectionInfo, MentionQuery } from './editor/geometry';
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

    // Split the embedded comments block out of the editor body once at mount.
    const initialSplit = useMemo(() => splitComments(initialContent), [initialContent]);

    const [content, setContent] = useState(initialSplit.body);
    const [threads, setThreads] = useState<CommentThread[]>(initialSplit.threads);
    const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>(initialFrontmatter ?? {});
    const [editorMode, setEditorMode] = useState<EditorMode>('rendered');
    const [rawContent, setRawContent] = useState('');
    const [parseError, setParseError] = useState<string | null>(null);

    const contentRef = useRef(content);
    const threadsRef = useRef(threads);
    const frontmatterRef = useRef(frontmatter);
    const editorModeRef = useRef<EditorMode>(editorMode);
    const rawContentRef = useRef(rawContent);
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<MilkdownEditorHandle>(null);

    const hasFrontmatterRef = useRef(hasFrontmatter);
    hasFrontmatterRef.current = hasFrontmatter;

    /** Full on-disk string: frontmatter + body + comments block. */
    const buildFull = useCallback((body: string, t: CommentThread[]) => {
      const withComments = joinComments(body, t);
      return hasFrontmatterRef.current ? serializeFm(frontmatterRef.current, withComments) : withComments;
    }, []);

    /** Strip frontmatter, returning the body+comments region. */
    const stripFm = useCallback((full: string) => {
      return hasFrontmatterRef.current ? (tryParseFm(full)?.body ?? full) : full;
    }, []);

    const initialFull = useMemo(
      () => buildFull(initialSplit.body, initialSplit.threads),
      [buildFull, initialSplit],
    );

    const lastSavedRef = useRef(initialFull);
    const lastDiskContentRef = useRef(initialFull);
    const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savingRef = useRef(false);

    const [isDragging, setIsDragging] = useState(false);
    const [personas, setPersonas] = useState<AgentPersona[]>(initialPersonas || []);
    const [presence, setPresence] = useState<CanvasPresence[]>(initialPresence || []);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [decorations, setDecorations] = useState<readonly CanvasDecoration[]>(initialDecorations || []);
    const [agentUsers, setAgentUsers] = useState<CanvasUser[]>([]);
    const [showLinkPicker, setShowLinkPicker] = useState(false);
    const [commentTrigger, setCommentTrigger] = useState<CommentTrigger>('caret');

    // Comment UI state
    const [activeComment, setActiveComment] = useState<{ id: string; rect: Rect } | null>(null);
    const [selection, setSelection] = useState<SelectionInfo | null>(null);
    const [composer, setComposer] = useState<{ quote: string; anchor: { prefix?: string; suffix?: string; kind?: string }; rect: Rect } | null>(null);

    // Mention suggestion state
    const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
    const [mentionIndex, setMentionIndex] = useState(0);
    const recentInlineMentions = useRef(new Set<string>());

    const personasRef = useRef(personas);
    personasRef.current = personas;

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
    threadsRef.current = threads;
    frontmatterRef.current = frontmatter;
    editorModeRef.current = editorMode;
    rawContentRef.current = rawContent;

    void agentUsers;

    /** Build the full document string for saving. */
    const getFullContent = useCallback(() => {
      if (editorModeRef.current === 'raw') return rawContentRef.current;
      return buildFull(contentRef.current, threadsRef.current);
    }, [buildFull]);

    // Merge persona users (for mention roster) with active agent users (for presence display)
    const users: CanvasUser[] = useMemo(
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
          const region = stripFm(savedContent);
          const { body, threads: savedThreads } = splitComments(region);
          setContent(body);
          contentRef.current = body;
          setThreads(savedThreads);
          threadsRef.current = savedThreads;
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
    }, [spaceId, onDirtyChange, onSaveStatus, getFullContent, stripFm]);

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

    const markDirtyAndSave = useCallback(() => {
      const dirty = getFullContent() !== lastSavedRef.current;
      onDirtyChange(dirty);
      if (dirty) {
        onSaveStatus('');
        scheduleSave();
      }
    }, [getFullContent, onDirtyChange, onSaveStatus, scheduleSave]);

    // Content change ORIGINATING in the editor (user typing).
    const onEditorContentChanged = useCallback((newBody: string) => {
      if (newBody === contentRef.current) return;
      setContent(newBody);
      contentRef.current = newBody;
      markDirtyAndSave();
    }, [markDirtyAndSave]);

    // Content change ORIGINATING in the host (voice, drop, links, replies).
    const applyProgrammaticContent = useCallback((newBody: string) => {
      if (newBody === contentRef.current) return;
      setContent(newBody);
      contentRef.current = newBody;
      if (editorModeRef.current === 'rendered') {
        editorRef.current?.replaceAll(newBody);
      }
      markDirtyAndSave();
    }, [markDirtyAndSave]);

    /** Update threads, re-highlight, and persist (body is unchanged). */
    const updateThreads = useCallback((next: CommentThread[]) => {
      setThreads(next);
      threadsRef.current = next;
      markDirtyAndSave();
    }, [markDirtyAndSave]);

    const fireMentions = useCallback((body: string, quote: string, anchor: { prefix?: string; suffix?: string }, threadId: string) => {
      if (!onAgentMentioned) return;
      const handles = extractMentions(body, personasRef.current.map(p => p.handle));
      if (handles.length === 0) return;
      onAgentMentioned({ handles, commentBody: body, quote, anchor, threadId });
    }, [onAgentMentioned]);

    const handleFrontmatterChange = useCallback((updated: Record<string, unknown>) => {
      setFrontmatter(updated);
      frontmatterRef.current = updated;
      markDirtyAndSave();
    }, [markDirtyAndSave]);

    const handleToggleMode = useCallback((): { mode: EditorMode; error?: string } => {
      if (editorModeRef.current === 'rendered') {
        const full = buildFull(contentRef.current, threadsRef.current);
        setRawContent(full);
        rawContentRef.current = full;
        setParseError(null);
        setEditorMode('raw');
        editorModeRef.current = 'raw';
        return { mode: 'raw' };
      } else {
        let region = rawContentRef.current;
        if (hasFrontmatter) {
          const parsed = tryParseFm(rawContentRef.current);
          if (!parsed) {
            const err = 'Invalid YAML frontmatter. Fix the syntax before switching to rendered view.';
            setParseError(err);
            return { mode: 'raw', error: err };
          }
          setFrontmatter(parsed.frontmatter);
          frontmatterRef.current = parsed.frontmatter;
          region = parsed.body;
        }
        const { body, threads: parsedThreads } = splitComments(region);
        setContent(body);
        contentRef.current = body;
        setThreads(parsedThreads);
        threadsRef.current = parsedThreads;
        setParseError(null);
        setEditorMode('rendered');
        editorModeRef.current = 'rendered';
        return { mode: 'rendered' };
      }
    }, [hasFrontmatter, buildFull]);

    const handleRawContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newRaw = e.target.value;
      setRawContent(newRaw);
      rawContentRef.current = newRaw;
      setParseError(null);
      // Keep body/threads refs roughly in sync so a save reflects raw edits.
      const region = hasFrontmatter ? (tryParseFm(newRaw)?.body ?? newRaw) : newRaw;
      const split = splitComments(region);
      contentRef.current = split.body;
      threadsRef.current = split.threads;
      if (hasFrontmatter) {
        const parsed = tryParseFm(newRaw);
        if (parsed) frontmatterRef.current = parsed.frontmatter;
      }
      markDirtyAndSave();
    }, [hasFrontmatter, markDirtyAndSave]);

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
        const current = threadsRef.current;
        const idx = current.findIndex(t => t.id === threadId);
        if (idx < 0) return;
        const next = current.map((t, i) =>
          i === idx ? { ...t, comments: [...t.comments, { body, updatedAt: new Date().toISOString() }] } : t,
        );
        updateThreads(next);
      },
      replaceContent: (newDiskContent: string) => {
        const { body: diskBody, threads: diskThreads } = splitComments(newDiskContent);

        // Comments are authoritative from disk.
        setThreads(diskThreads);
        threadsRef.current = diskThreads;

        if (editorModeRef.current === 'raw') {
          if (pendingSaveRef.current) { clearTimeout(pendingSaveRef.current); pendingSaveRef.current = null; }
          const full = buildFull(diskBody, diskThreads);
          setRawContent(full);
          rawContentRef.current = full;
          setContent(diskBody);
          contentRef.current = diskBody;
          lastSavedRef.current = full;
          lastDiskContentRef.current = full;
          onDirtyChange(false);
          return;
        }

        const currentBody = contentRef.current;
        const baseBody = splitComments(stripFm(lastDiskContentRef.current)).body;
        const fullDisk = buildFull(diskBody, diskThreads);
        lastDiskContentRef.current = fullDisk;

        // Fast path: no local edits since last disk sync.
        if (currentBody === baseBody) {
          if (pendingSaveRef.current) { clearTimeout(pendingSaveRef.current); pendingSaveRef.current = null; }
          setContent(diskBody);
          contentRef.current = diskBody;
          editorRef.current?.replaceAll(diskBody);
          lastSavedRef.current = fullDisk;
          onDirtyChange(false);
          return;
        }

        // Merge path: three-way merge of the body.
        const { merged } = merge3(baseBody, currentBody, diskBody);
        if (pendingSaveRef.current) { clearTimeout(pendingSaveRef.current); pendingSaveRef.current = null; }
        setContent(merged);
        contentRef.current = merged;
        editorRef.current?.replaceAll(merged);

        const fullMerged = buildFull(merged, diskThreads);
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
    }), [saveNow, applyProgrammaticContent, updateThreads, scheduleSave, buildFull, stripFm, onDirtyChange, getFullContent, handleToggleMode]);

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

    // Resolve workspace-relative image srcs into object URLs for display.
    const resolveImageSrc = useCallback(async (src: string): Promise<string | null> => {
      try {
        const r = await whimAPI.readFile(spaceId, src);
        if (r.error || !r.data) return null;
        const blob = new Blob([new Uint8Array(r.data)], { type: r.mimeType || 'application/octet-stream' });
        return URL.createObjectURL(blob);
      } catch {
        return null;
      }
    }, [spaceId]);

    // Persist a pasted image and return its workspace-relative src.
    const uploadFile = useCallback(async (file: File): Promise<{ src: string } | null> => {
      try {
        const buffer = await file.arrayBuffer();
        const dataArray = Array.from(new Uint8Array(buffer));
        const r = await whimAPI.pasteFile(spaceId, file.name, dataArray);
        if (r.error || !r.relativePath) return null;
        return { src: r.relativePath };
      } catch {
        return null;
      }
    }, [spaceId]);

    // Route link clicks: whim:// to window openers, everything else to the host.
    const handleLinkClick = useCallback((url: string) => {
      if (url.startsWith('whim://')) {
        openWhimResource(url);
        return;
      }
      whimAPI.openLink(spaceId, url);
    }, [spaceId]);

    // ── Comment interactions ───────────────────────────────
    const handleCommentActivate = useCallback((threadId: string | null, rect: Rect | null) => {
      if (threadId && rect) {
        setComposer(null);
        setActiveComment({ id: threadId, rect });
      } else {
        setActiveComment(null);
      }
    }, []);

    const handleSelectionChange = useCallback((info: SelectionInfo | null) => {
      setSelection(info);
    }, []);

    const handleStartComment = useCallback(() => {
      const anchor = editorRef.current?.getSelectionAnchor();
      const sel = selection;
      if (!anchor || !sel) return;
      setSelection(null);
      setActiveComment(null);
      setComposer({ quote: anchor.quote, anchor: anchor.anchor, rect: sel.rect });
    }, [selection]);

    const handleComposerSubmit = useCallback((body: string) => {
      const c = composer;
      if (!c) return;
      const thread: CommentThread = {
        id: newThreadId(),
        quote: c.quote,
        comments: [{ body, updatedAt: new Date().toISOString() }],
        anchor: { kind: 'text', prefix: c.anchor.prefix, suffix: c.anchor.suffix },
      };
      updateThreads([...threadsRef.current, thread]);
      fireMentions(body, thread.quote, { prefix: thread.anchor.prefix, suffix: thread.anchor.suffix }, thread.id);
      setComposer(null);
    }, [composer, updateThreads, fireMentions]);

    const handleReply = useCallback((body: string) => {
      const id = activeComment?.id;
      if (!id) return;
      const current = threadsRef.current;
      const thread = current.find(t => t.id === id);
      if (!thread) return;
      const next = current.map(t =>
        t.id === id ? { ...t, comments: [...t.comments, { body, updatedAt: new Date().toISOString() }] } : t,
      );
      updateThreads(next);
      fireMentions(body, thread.quote, { prefix: thread.anchor.prefix, suffix: thread.anchor.suffix }, thread.id);
    }, [activeComment, updateThreads, fireMentions]);

    const handleResolve = useCallback(() => {
      const id = activeComment?.id;
      if (!id) return;
      const next = threadsRef.current.map(t =>
        t.id === id ? { ...t, resolvedAt: t.resolvedAt ? undefined : new Date().toISOString() } : t,
      );
      updateThreads(next);
    }, [activeComment, updateThreads]);

    const handleDeleteThread = useCallback(() => {
      const id = activeComment?.id;
      if (!id) return;
      updateThreads(threadsRef.current.filter(t => t.id !== id));
      setActiveComment(null);
    }, [activeComment, updateThreads]);

    // ── Mention suggestions ────────────────────────────────
    const mentionCandidates: MentionCandidate[] = useMemo(() => {
      if (!mentionQuery) return [];
      const q = mentionQuery.query.toLowerCase();
      return personas
        .filter(p => p.handle.toLowerCase().includes(q))
        .slice(0, 8)
        .map(p => ({ handle: p.handle, emoji: p.emoji, model: p.model }));
    }, [mentionQuery, personas]);

    const mentionCandidatesRef = useRef(mentionCandidates);
    mentionCandidatesRef.current = mentionCandidates;
    const mentionIndexRef = useRef(mentionIndex);
    mentionIndexRef.current = mentionIndex;

    const handleMentionQuery = useCallback((info: MentionQuery | null) => {
      setMentionQuery(info);
      setMentionIndex(0);
    }, []);

    const applySelectedMention = useCallback((handle: string) => {
      const mq = mentionQuery;
      if (!mq) return;
      setMentionQuery(null);
      const result = editorRef.current?.applyMention(handle, mq.from, mq.to);
      if (result && onInlineMention) {
        const key = `${handle}:${result.lineNumber}:${result.lineMarkdown}`;
        if (recentInlineMentions.current.has(key)) return;
        recentInlineMentions.current.add(key);
        setTimeout(() => recentInlineMentions.current.delete(key), 5000);
        onInlineMention(handle, result.lineMarkdown, result.lineNumber);
      }
    }, [mentionQuery, onInlineMention]);

    // Intercept navigation keys while the mention popup is open (before the editor).
    useEffect(() => {
      if (!mentionQuery) return;
      const handler = (e: KeyboardEvent) => {
        const list = mentionCandidatesRef.current;
        if (list.length === 0) {
          if (e.key === 'Escape') setMentionQuery(null);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex(i => Math.min(i + 1, list.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const c = list[mentionIndexRef.current];
          if (c) applySelectedMention(c.handle);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setMentionQuery(null);
        }
      };
      document.addEventListener('keydown', handler, true);
      return () => document.removeEventListener('keydown', handler, true);
    }, [mentionQuery, applySelectedMention]);

    // File drag-and-drop handler
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const handleDragOver = (e: DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
      };
      const handleDragLeave = () => setIsDragging(false);
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
            const ref2 = formatAttachmentRef(result.filename!, result.relativePath!, file.type);
            insertAttachment(ref2);
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
      const separator = current.endsWith('\n') ? '\n' : '\n\n';
      applyProgrammaticContent(current + separator + VOICE_PLACEHOLDER + '\n');
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
        const block = transcription ? `${audioRef}\n\n${transcription}` : audioRef;
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
        if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
      };
    }, []);

    // Auto-focus the editor after mount
    useEffect(() => {
      if (editorMode !== 'rendered') return;
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => editorRef.current?.focus());
      });
      return () => cancelAnimationFrame(raf);
    }, [editorMode]);

    const activeThread = activeComment ? threads.find(t => t.id === activeComment.id) ?? null : null;

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
                presence={presence}
                commentThreads={threads}
                activeCommentId={activeComment?.id ?? null}
                commentTrigger={commentTrigger}
                resolveImageSrc={resolveImageSrc}
                uploadFile={uploadFile}
                onCommentActivate={handleCommentActivate}
                onSelectionChange={handleSelectionChange}
                onMentionQuery={handleMentionQuery}
                onLinkClick={handleLinkClick}
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
            {selection && !composer && (
              <SelectionToolbar
                rect={selection.rect}
                onComment={handleStartComment}
                onFork={onForkSelection ? () => { onForkSelection(selection.text); setSelection(null); } : undefined}
                onExtract={onExtractToPage ? () => { onExtractToPage(selection.text); setSelection(null); } : undefined}
              />
            )}
            {composer && (
              <CommentComposer
                rect={composer.rect}
                quote={composer.quote}
                onSubmit={handleComposerSubmit}
                onCancel={() => setComposer(null)}
              />
            )}
            {activeThread && activeComment && (
              <CommentPopover
                thread={activeThread}
                rect={activeComment.rect}
                roster={personas.map(p => p.handle)}
                onReply={handleReply}
                onResolve={handleResolve}
                onDelete={handleDeleteThread}
                onClose={() => setActiveComment(null)}
              />
            )}
            {mentionQuery && mentionCandidates.length > 0 && (
              <MentionPopup
                rect={mentionQuery.rect}
                candidates={mentionCandidates}
                activeIndex={mentionIndex}
                onSelect={applySelectedMention}
                onHover={setMentionIndex}
              />
            )}
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

// Inline mention support lives in the mention plugin (p4); these are re-exported
// for the host event types.
export type { CommentThread };
