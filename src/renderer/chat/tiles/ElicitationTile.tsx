import React, { useState, useEffect } from 'react';

interface ElicitationTileProps {
  requestId: string;
  message: string;
  requestedSchema?: { type: "object"; properties: Record<string, any>; required?: string[] };
  mode?: 'form' | 'url';
  elicitationSource?: string;
  responded: boolean;
  action?: 'accept' | 'decline' | 'cancel';
  content?: Record<string, any>;
  onRespond: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, any>) => void;
}

type FieldValue = string | number | boolean | string[];

function getDefaultValues(properties: Record<string, any>): Record<string, FieldValue> {
  const defaults: Record<string, FieldValue> = {};
  for (const [key, field] of Object.entries(properties)) {
    if (field.default !== undefined) {
      defaults[key] = field.default;
    } else if (field.type === 'boolean') {
      defaults[key] = false;
    } else if (field.type === 'array') {
      defaults[key] = [];
    } else if (field.type === 'number' || field.type === 'integer') {
      defaults[key] = '' as any;
    } else {
      defaults[key] = '';
    }
  }
  return defaults;
}

function getInputType(format?: string): string {
  switch (format) {
    case 'email': return 'email';
    case 'uri': return 'url';
    case 'date': return 'date';
    case 'date-time': return 'datetime-local';
    default: return 'text';
  }
}

function isSelectField(field: any): boolean {
  return field.type === 'string' && (Array.isArray(field.enum) || Array.isArray(field.oneOf));
}

function isMultiSelectField(field: any): boolean {
  return field.type === 'array' && field.items &&
    (Array.isArray(field.items.enum) || Array.isArray(field.items.anyOf));
}

function getSelectOptions(field: any): { value: string; label: string }[] {
  if (Array.isArray(field.enum)) {
    const names = field.enumNames;
    return field.enum.map((v: string, i: number) => ({
      value: v,
      label: names && names[i] ? names[i] : v,
    }));
  }
  if (Array.isArray(field.oneOf)) {
    return field.oneOf.map((o: any) => ({ value: o.const, label: o.title || o.const }));
  }
  return [];
}

function getMultiSelectOptions(field: any): { value: string; label: string }[] {
  const items = field.items;
  if (!items) return [];
  if (Array.isArray(items.enum)) {
    return items.enum.map((v: string) => ({ value: v, label: v }));
  }
  if (Array.isArray(items.anyOf)) {
    return items.anyOf.map((o: any) => ({ value: o.const, label: o.title || o.const }));
  }
  return [];
}

function isValid(
  values: Record<string, FieldValue>,
  properties: Record<string, any>,
  required: string[],
): boolean {
  for (const key of required) {
    const val = values[key];
    if (val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) {
      return false;
    }
  }
  return true;
}

function formatValue(value: FieldValue): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

const successSvg = <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="7" fill="#22c55e"/><path d="M4 7.2L6 9.2L10 5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const declinedSvg = <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="7" fill="#6b7280"/><path d="M4.5 4.5L9.5 9.5M9.5 4.5L4.5 9.5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>;
const cancelledSvg = <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="7" fill="#ef4444"/><path d="M4.5 4.5L9.5 9.5M9.5 4.5L4.5 9.5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>;

// Show inline option list for enums with ≤ this many options; fall back to <select> for more
const INLINE_OPTIONS_THRESHOLD = 6;

export function ElicitationTile({
  requestId,
  message,
  requestedSchema,
  elicitationSource,
  responded,
  action,
  content,
  onRespond,
}: ElicitationTileProps) {
  const properties = requestedSchema?.properties ?? {};
  const required = requestedSchema?.required ?? [];

  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    getDefaultValues(properties),
  );

  useEffect(() => {
    setValues(getDefaultValues(properties));
  }, [requestedSchema]);

  const setValue = (key: string, val: FieldValue) => {
    setValues(prev => ({ ...prev, [key]: val }));
  };

  const toggleArrayValue = (key: string, option: string) => {
    setValues(prev => {
      const current = (prev[key] as string[]) || [];
      const next = current.includes(option)
        ? current.filter(v => v !== option)
        : [...current, option];
      return { ...prev, [key]: next };
    });
  };

  const canSubmit = isValid(values, properties, required);

  const showSource =
    elicitationSource && elicitationSource !== '__copilot_agent__';

  const statusIcon = responded
    ? (action === 'accept' ? successSvg : action === 'decline' ? declinedSvg : cancelledSvg)
    : null;
  const statusClass = responded
    ? (action === 'accept' ? 'success' : 'error')
    : 'running';

  return (
    <div className="chat-tool-tile border-blue">
      <div className="chat-tool-header">
        <span className={`chat-tool-status ${statusClass}`} aria-hidden="true">
          {statusIcon || '●'}
        </span>
        <span className="chat-tool-title">
          <span className="chat-tool-label">Elicitation</span>
        </span>
        <span className="elicitation-message-preview">{message}</span>
        {showSource && (
          <span className="elicitation-source-badge">{elicitationSource}</span>
        )}
      </div>

      {responded ? (
        <div className="elicitation-response">
          {action === 'accept' && content ? (
            Object.entries(properties).map(([key, field]) => {
              const val = content[key];
              if (val === undefined) return null;
              return (
                <div key={key} className="elicitation-response-field">
                  <span className="elicitation-response-label">
                    {(field as any).title || key}:
                  </span>{' '}
                  <span className="elicitation-response-value">
                    {formatValue(val)}
                  </span>
                </div>
              );
            })
          ) : (
            <span className={`elicitation-response-status ${action}`}>
              {action === 'decline' ? 'Declined' : 'Cancelled'}
            </span>
          )}
        </div>
      ) : (
        <div className="elicitation-controls">
          <div className="elicitation-form">
            {Object.entries(properties).map(([key, field]) => {
              const f = field as any;
              const isRequired = required.includes(key);
              const label = f.title || key;

              return (
                <div key={key} className="elicitation-field">
                  <label className="elicitation-field-label">
                    {label}
                    {isRequired && <span className="elicitation-required">*</span>}
                  </label>

                  {isSelectField(f) && (() => {
                    const options = getSelectOptions(f);
                    if (options.length <= INLINE_OPTIONS_THRESHOLD) {
                      return (
                        <div className="elicitation-option-list" role="radiogroup" aria-label={label}>
                          {options.map(opt => {
                            const isSelected = (values[key] as string) === opt.value;
                            return (
                              <button
                                key={opt.value}
                                className={`elicitation-option ${isSelected ? 'selected' : ''}`}
                                role="radio"
                                aria-checked={isSelected}
                                onClick={() => setValue(key, opt.value)}
                              >
                                <span className="elicitation-option-indicator" aria-hidden="true">
                                  {isSelected ? '●' : '○'}
                                </span>
                                <span>{opt.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    }
                    // Fall back to native select for large option sets
                    return (
                      <select
                        className="elicitation-select"
                        value={(values[key] as string) ?? ''}
                        onChange={e => setValue(key, e.target.value)}
                      >
                        <option value="">— Select —</option>
                        {options.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    );
                  })()}

                  {isMultiSelectField(f) && (
                    <div className="elicitation-pill-group" role="group" aria-label={label}>
                      {getMultiSelectOptions(f).map(opt => {
                        const isActive = ((values[key] as string[]) || []).includes(opt.value);
                        return (
                          <button
                            key={opt.value}
                            className={`elicitation-pill ${isActive ? 'active' : ''}`}
                            aria-pressed={isActive}
                            onClick={() => toggleArrayValue(key, opt.value)}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {f.type === 'boolean' && (
                    <label className="elicitation-checkbox">
                      <input
                        type="checkbox"
                        checked={!!values[key]}
                        onChange={e => setValue(key, e.target.checked)}
                      />
                      <span>{f.description || label}</span>
                    </label>
                  )}

                  {(f.type === 'number' || f.type === 'integer') && (
                    <input
                      type="number"
                      className="elicitation-input"
                      value={values[key] === '' ? '' : String(values[key])}
                      min={f.minimum}
                      max={f.maximum}
                      step={f.type === 'integer' ? 1 : undefined}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === '') {
                          setValue(key, '' as any);
                        } else {
                          setValue(key, f.type === 'integer' ? parseInt(raw, 10) : parseFloat(raw));
                        }
                      }}
                    />
                  )}

                  {f.type === 'string' && !isSelectField(f) && (
                    <input
                      type={getInputType(f.format)}
                      className="elicitation-input"
                      value={(values[key] as string) ?? ''}
                      minLength={f.minLength}
                      maxLength={f.maxLength}
                      onChange={e => setValue(key, e.target.value)}
                    />
                  )}

                  {f.description && f.type !== 'boolean' && (
                    <div className="elicitation-help">{f.description}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="elicitation-actions">
            <button
              className="elicitation-btn accept"
              disabled={!canSubmit}
              onClick={() => onRespond(requestId, 'accept', values)}
            >
              Accept
            </button>
            <button
              className="elicitation-btn decline"
              onClick={() => onRespond(requestId, 'decline')}
            >
              Decline
            </button>
            <button
              className="elicitation-btn cancel"
              onClick={() => onRespond(requestId, 'cancel')}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
