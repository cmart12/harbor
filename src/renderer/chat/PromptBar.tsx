import React, { useState, useRef, useCallback, useEffect } from 'react';

interface PromptBarProps {
  onSend: (message: string) => void;
  disabled: boolean;
  placeholder?: string;
}

const MAX_ROWS = 6;

export function PromptBar({ onSend, disabled, placeholder }: PromptBarProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    onSend(trimmed);
    setValue('');
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <div className="chat-prompt-bar">
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
