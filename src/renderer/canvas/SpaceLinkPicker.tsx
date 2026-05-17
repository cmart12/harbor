import React, { useState, useEffect, useRef, useCallback } from 'react';

export interface SpaceResult {
  id: string;
  description: string;
  status: string;
}

interface SpaceLinkPickerProps {
  onSelect: (space: SpaceResult) => void;
  onDismiss: () => void;
}

export function SpaceLinkPicker({ onSelect, onDismiss }: SpaceLinkPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpaceResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allSpaces, setAllSpaces] = useState<SpaceResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load all spaces on mount
  useEffect(() => {
    (window as any).whimAPI.list().then((spaces: SpaceResult[]) => {
      setAllSpaces(spaces);
      setResults(spaces);
    });
  }, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Filter results as query changes
  useEffect(() => {
    if (!query.trim()) {
      setResults(allSpaces);
      setSelectedIndex(0);
      return;
    }

    const lower = query.toLowerCase();
    const filtered = allSpaces.filter(s =>
      s.description.toLowerCase().includes(lower)
    );
    setResults(filtered);
    setSelectedIndex(0);

    // Also do a server-side search for deeper results
    const timer = setTimeout(() => {
      (window as any).whimAPI.searchSpaces(query).then((serverResults: SpaceResult[]) => {
        // Merge: server results may include matches not in allSpaces (archived, etc.)
        const ids = new Set(filtered.map(s => s.id));
        const extra = serverResults.filter(s => !ids.has(s.id));
        if (extra.length > 0) {
          setResults(prev => [...prev, ...extra]);
        }
      });
    }, 200);

    return () => clearTimeout(timer);
  }, [query, allSpaces]);

  // Click outside to dismiss
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onDismiss]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        onSelect(results[selectedIndex]);
      }
    }
  }, [results, selectedIndex, onSelect, onDismiss]);

  // Scroll selected item into view
  useEffect(() => {
    const el = containerRef.current?.querySelector('.space-link-picker-item.selected');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div className="space-link-picker-overlay">
      <div className="space-link-picker" ref={containerRef}>
        <input
          ref={inputRef}
          className="space-link-picker-input"
          type="text"
          placeholder="Search spaces to link…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="space-link-picker-results">
          {results.length === 0 && query && (
            <div className="space-link-picker-empty">No spaces found</div>
          )}
          {results.map((space, i) => (
            <div
              key={space.id}
              className={`space-link-picker-item${i === selectedIndex ? ' selected' : ''}${space.status === 'done' ? ' done' : ''}`}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => onSelect(space)}
            >
              <span className="space-link-picker-status">
                {space.status === 'done' ? '✓' : '○'}
              </span>
              <span className="space-link-picker-desc">{space.description || 'Untitled'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
