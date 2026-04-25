import React, { useState, useRef, useCallback, useEffect } from 'react';

type FileAttachment = { type: 'file'; name: string; path: string };

interface PromptBarProps {
  onSend: (message: string, attachments?: FileAttachment[]) => void;
  disabled: boolean;
  placeholder?: string;
}

const MAX_ROWS = 6;

function filesFromInput(fileList: FileList): FileAttachment[] {
  return Array.from(fileList).map((f) => ({
    type: 'file' as const,
    name: f.name,
    path: (f as any).path || f.name,
  }));
}

export function PromptBar({ onSend, disabled, placeholder }: PromptBarProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
    const maxHeight = lineHeight * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setValue('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend, attachments]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setAttachments((prev) => [...prev, ...filesFromInput(e.target.files!)]);
      e.target.value = '';
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setAttachments((prev) => [...prev, ...filesFromInput(e.dataTransfer.files)]);
    }
  }, []);

  return (
    <div
      className={`chat-prompt-bar${dragOver ? ' drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {attachments.length > 0 && (
        <div className="chat-prompt-attachments">
          {attachments.map((att, i) => (
            <span key={i} className="chat-prompt-attachment" title={att.path}>
              📎 {att.name}
              <button
                className="chat-prompt-attachment-remove"
                onClick={() => removeAttachment(i)}
                title="Remove"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="chat-prompt-input-wrap">
        <textarea
          ref={textareaRef}
          className="chat-prompt-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || 'Send a message...'}
          disabled={disabled}
          rows={1}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <button
          className="chat-prompt-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          title="Attach files"
        >
          📎
        </button>
        <button
          className="chat-prompt-send"
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          title="Send (Enter)"
        >
          ↩
        </button>
      </div>
    </div>
  );
}
