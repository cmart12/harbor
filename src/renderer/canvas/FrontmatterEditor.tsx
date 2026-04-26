import React, { useCallback, useState } from 'react';

export interface FrontmatterEditorProps {
  frontmatter: Record<string, unknown>;
  onChange: (updated: Record<string, unknown>) => void;
}

const KNOWN_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'name', label: 'Name', placeholder: 'Skill name' },
  { key: 'description', label: 'Description', placeholder: 'Brief description' },
];

export const FrontmatterEditor: React.FC<FrontmatterEditorProps> = ({ frontmatter, onChange }) => {
  const [expanded, setExpanded] = useState(false);

  const handleFieldChange = useCallback((key: string, value: string) => {
    onChange({ ...frontmatter, [key]: value });
  }, [frontmatter, onChange]);

  const extraKeys = Object.keys(frontmatter).filter(
    k => !KNOWN_FIELDS.some(f => f.key === k) && frontmatter[k] !== undefined && frontmatter[k] !== null,
  );

  const name = String(frontmatter.name ?? '');
  const desc = String(frontmatter.description ?? '');
  const summary = [name, desc].filter(Boolean).join(' — ') || 'Properties';

  return (
    <div className={`frontmatter-editor${expanded ? ' expanded' : ''}`}>
      <button
        className="frontmatter-header"
        onClick={() => setExpanded(e => !e)}
        type="button"
      >
        <span className={`frontmatter-chevron${expanded ? ' open' : ''}`}>›</span>
        <span className="frontmatter-summary" title={summary}>{summary}</span>
      </button>
      {expanded && (
        <div className="frontmatter-fields">
          {KNOWN_FIELDS.map(({ key, label, placeholder }) => (
            <div key={key} className="frontmatter-field">
              <label className="frontmatter-label">{label}</label>
              <input
                type="text"
                className="frontmatter-input"
                value={String(frontmatter[key] ?? '')}
                placeholder={placeholder}
                onChange={(e) => handleFieldChange(key, e.target.value)}
              />
            </div>
          ))}
          {extraKeys.length > 0 && (
            <div className="frontmatter-extra">
              {extraKeys.map(key => {
                const val = frontmatter[key];
                const display = typeof val === 'string' ? val : JSON.stringify(val);
                return (
                  <div key={key} className="frontmatter-extra-item">
                    <span className="frontmatter-extra-key">{key}</span>
                    <span className="frontmatter-extra-value" title={display}>{display}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
