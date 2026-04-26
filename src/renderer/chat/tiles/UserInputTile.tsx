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

  return (
    <div className={`chat-user-input-tile ${responded ? 'responded' : 'pending'}`}>
      <div className="chat-user-input-icon">❓</div>
      <div className="chat-user-input-body">
        <div className="chat-user-input-label">Agent needs your input</div>
        <div className="chat-user-input-question">{question}</div>
        {responded ? (
          <div className="chat-user-input-result">
            {answer ? `✓ ${answer}` : '✗ Dismissed'}
            {answer && wasFreeform && <span className="chat-user-input-freeform-tag"> (freeform)</span>}
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
