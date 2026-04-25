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
  getSetting(key: string): Promise<string | null>;
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

    contentRef.current = content;

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
      if (newContent === contentRef.current) return;
      setContent(newContent);
      const dirty = newContent !== lastSavedRef.current;
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

    const documintTheme = theme === 'dark'
      ? { ...darkTheme, background: '#1c1c20', leafBackground: '#1c1c20', selectionHandleBackground: '#1c1c20' }
      : lightTheme;

    return (
      <div
        ref={containerRef}
        className={`documint-canvas-container${isDragging ? ' drag-over' : ''}`}
      >
        <Documint
          content={content}
          onContentChange={handleContentChange}
          onStateChange={handleStateChange}
          theme={documintTheme}
        />
      </div>
    );
  }
);
