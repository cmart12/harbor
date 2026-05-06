import React, { useState } from 'react';

interface UserInputTileProps {
  requestId: string;
  question: string;
  choices?: string[];
  allowFreeform?: boolean;
  responded: boolean;
  answer?: string;
  wasFreeform?: boolean;
  onRespond: (requestId: string, answer: string, wasFreeform: boolean) => void;
}

const successSvg = <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="7" fill="#22c55e"/><path d="M4 7.2L6 9.2L10 5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const dismissedSvg = <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="7" fill="#6b7280"/><path d="M4.5 4.5L9.5 9.5M9.5 4.5L4.5 9.5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>;

export function UserInputTile({
  requestId,
  question,
  choices,
  allowFreeform,
  responded,
  answer,
  wasFreeform,
  onRespond,
}: UserInputTileProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [freeformText, setFreeformText] = useState('');
  const [usingFreeform, setUsingFreeform] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const showFreeform = allowFreeform || !choices?.length;
  const currentAnswer = usingFreeform ? freeformText : selected;

  function handleChoiceClick(choice: string) {
    setSelected(choice);
    setUsingFreeform(false);
  }

  function handleFreeformChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFreeformText(e.target.value);
    setUsingFreeform(true);
    setSelected(null);
  }

  function handleSubmit() {
    if (currentAnswer != null && currentAnswer !== '') {
      onRespond(requestId, currentAnswer, usingFreeform);
    }
  }

  function handleDismiss() {
    onRespond(requestId, '', false);
  }

  const statusIcon = responded
    ? (answer ? successSvg : dismissedSvg)
    : null;

  return (
    <div className={`chat-tool-tile border-gold`}>
      <div
        className="chat-tool-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
      >
        <span className={`chat-tool-status ${responded ? (answer ? 'success' : 'error') : 'running'}`} aria-hidden="true">
          {statusIcon || '●'}
        </span>
        <span className="chat-tool-title">
          <span className="chat-tool-label">Ask User</span>
        </span>
        <span className="chat-user-input-question-preview">{question}</span>
        <span className={`chat-tool-chevron ${expanded ? 'expanded' : ''}`}>▸</span>
      </div>

      {expanded && (
        <div className="chat-user-input-question-full">{question}</div>
      )}

      {responded ? (
        answer ? (
          <div className="chat-user-input-response">
            {answer}
            {wasFreeform && <span className="chat-user-input-freeform-tag"> (freeform)</span>}
          </div>
        ) : (
          <div className="chat-user-input-response dismissed">Dismissed</div>
        )
      ) : (
        <div className="chat-user-input-controls">
          {choices && choices.length > 0 && (
            <div className="chat-user-input-choices">
              {choices.map((choice) => (
                <button
                  key={choice}
                  className={`chat-user-input-choice ${selected === choice ? 'selected' : ''}`}
                  onClick={() => handleChoiceClick(choice)}
                >
                  {choice}
                </button>
              ))}
            </div>
          )}
          {showFreeform && (
            <div className="chat-user-input-freeform">
              <input
                type="text"
                className="chat-user-input-text"
                placeholder="Type your answer…"
                value={freeformText}
                onChange={handleFreeformChange}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
              />
            </div>
          )}
          <div className="chat-user-input-actions">
            <button
              className="chat-user-input-btn submit"
              disabled={!currentAnswer}
              onClick={handleSubmit}
            >
              Submit
            </button>
            <button
              className="chat-user-input-btn dismiss"
              onClick={handleDismiss}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
