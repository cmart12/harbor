import React, { useCallback, useState } from 'react';

export interface FrontmatterEditorProps {
  frontmatter: Record<string, unknown>;
  personas?: Array<{ handle: string; emoji?: string }>;
  onChange: (updated: Record<string, unknown>) => void;
}

const KNOWN_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'name', label: 'Name', placeholder: 'Skill name' },
  { key: 'description', label: 'Description', placeholder: 'Brief description' },
];

/** Fields managed by other UI — hidden from the generic extra-keys display. */
const MANAGED_FIELDS = new Set(['name', 'description', 'instructions', 'preferred_agent', 'skills', 'skill_invocation']);

export const FrontmatterEditor: React.FC<FrontmatterEditorProps> = ({ frontmatter, personas = [], onChange }) => {
  const [expanded, setExpanded] = useState(false);

  const handleFieldChange = useCallback((key: string, value: string) => {
    const next = { ...frontmatter };
    if (value.trim().length === 0 && (key === 'instructions' || key === 'preferred_agent')) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  }, [frontmatter, onChange]);

  const extraKeys = Object.keys(frontmatter).filter(
    k => !MANAGED_FIELDS.has(k) && frontmatter[k] !== undefined && frontmatter[k] !== null,
  );

  const name = String(frontmatter.name ?? '');
  const desc = String(frontmatter.description ?? '');
  const instructions = String(frontmatter.instructions ?? '');
  const preferredAgent = String(frontmatter.preferred_agent ?? '');
  const summary = [name, desc, instructions ? 'Runnable instructions' : '', preferredAgent ? `@${preferredAgent}` : ''].filter(Boolean).join(' — ') || 'Properties';

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
          <div className="frontmatter-field frontmatter-field-stacked">
            <label className="frontmatter-label">Instructions</label>
            <textarea
              className="frontmatter-input frontmatter-textarea"
              value={instructions}
              placeholder="Instructions that should drive Run Canvas"
              rows={4}
              onChange={(e) => handleFieldChange('instructions', e.target.value)}
            />
          </div>
          <div className="frontmatter-field">
            <label className="frontmatter-label">Agent</label>
            <select
              className="frontmatter-input"
              value={preferredAgent}
              onChange={(e) => handleFieldChange('preferred_agent', e.target.value)}
            >
              <option value="">Default agent</option>
              {personas.map((persona) => (
                <option key={persona.handle} value={persona.handle}>
                  {persona.emoji ? `${persona.emoji} ` : ''}@{persona.handle}
                </option>
              ))}
            </select>
          </div>
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
