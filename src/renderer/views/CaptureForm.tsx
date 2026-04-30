import React from 'react';

export interface CaptureFormProps {
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

/**
 * Space capture form — text input with voice transcription.
 * TODO: Migrate capture form UI from app.ts
 */
export function CaptureForm(props: CaptureFormProps) {
  return <div className="capture-form">CaptureForm (not yet migrated)</div>;
}
