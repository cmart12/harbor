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
    return field.oneOf.map((o: any) => ({ value: o.const, label: o.title }));
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
    return items.anyOf.map((o: any) => ({ value: o.const, label: o.title }));
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

  // Re-initialize when schema changes
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

  if (responded) {
    return (
      <div className="chat-elicitation-tile responded">
        <div className="chat-elicitation-icon">📝</div>
        <div className="chat-elicitation-body">
          <div className="chat-elicitation-header">
            <div className="chat-elicitation-label">{message}</div>
            {showSource && (
              <span className="chat-elicitation-source">{elicitationSource}</span>
            )}
          </div>
          {action === 'accept' && content ? (
            <div className="chat-elicitation-submitted">
              {Object.entries(properties).map(([key, field]) => {
                const val = content[key];
                if (val === undefined) return null;
                return (
                  <div key={key} className="chat-elicitation-submitted-field">
                    <span className="chat-elicitation-submitted-label">
                      {(field as any).title || key}:
                    </span>{' '}
                    <span className="chat-elicitation-submitted-value">
                      {formatValue(val)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              className={`chat-elicitation-result ${action === 'decline' ? 'declined' : 'cancelled'}`}
            >
              {action === 'decline' ? 'Declined' : 'Cancelled'}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-elicitation-tile pending">
      <div className="chat-elicitation-icon">📝</div>
      <div className="chat-elicitation-body">
        <div className="chat-elicitation-header">
          <div className="chat-elicitation-label">{message}</div>
          {showSource && (
            <span className="chat-elicitation-source">{elicitationSource}</span>
          )}
        </div>

        <div className="chat-elicitation-form">
          {Object.entries(properties).map(([key, field]) => {
            const f = field as any;
            const isRequired = required.includes(key);
            const label = f.title || key;

            return (
              <div key={key} className="chat-elicitation-field">
                <label className="chat-elicitation-field-label">
                  {label}
                  {isRequired && <span className="chat-elicitation-required">*</span>}
                </label>

                {isSelectField(f) && (
                  <select
                    className="chat-elicitation-select"
                    value={(values[key] as string) ?? ''}
                    onChange={e => setValue(key, e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {getSelectOptions(f).map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}

                {isMultiSelectField(f) && (
                  <div className="chat-elicitation-checkboxes">
                    {getMultiSelectOptions(f).map(opt => (
                      <label key={opt.value} className="chat-elicitation-checkbox-label">
                        <input
                          type="checkbox"
                          checked={((values[key] as string[]) || []).includes(opt.value)}
                          onChange={() => toggleArrayValue(key, opt.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                )}

                {f.type === 'boolean' && (
                  <label className="chat-elicitation-checkbox-label">
                    <input
                      type="checkbox"
                      checked={!!values[key]}
                      onChange={e => setValue(key, e.target.checked)}
                    />
                    {f.description || label}
                  </label>
                )}

                {(f.type === 'number' || f.type === 'integer') && (
                  <input
                    type="number"
                    className="chat-elicitation-input"
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
                    className="chat-elicitation-input"
                    value={(values[key] as string) ?? ''}
                    minLength={f.minLength}
                    maxLength={f.maxLength}
                    onChange={e => setValue(key, e.target.value)}
                  />
                )}

                {f.description && f.type !== 'boolean' && (
                  <div className="chat-elicitation-help">{f.description}</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="chat-elicitation-actions">
          <button
            className="chat-elicitation-btn accept"
            disabled={!canSubmit}
            onClick={() => onRespond(requestId, 'accept', values)}
          >
            Accept
          </button>
          <button
            className="chat-elicitation-btn decline"
            onClick={() => onRespond(requestId, 'decline')}
          >
            Decline
          </button>
          <button
            className="chat-elicitation-btn cancel"
            onClick={() => onRespond(requestId, 'cancel')}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
