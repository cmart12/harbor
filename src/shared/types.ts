export interface Attachment {
  type: 'url';
  name: string;
  url: string;
}

export interface Intent {
  id: string;
  description: string;
  body: string | null;
  raw_text: string | null;
  client: string | null;
  due_at: string | null;
  due_at_utc: string | null;
  recurrence: string | null;
  completed_at: string | null;
  folder: string | null;
  session_id: string | null;
  attachments: Attachment[];
  status: 'captured' | 'in_progress' | 'done';
  created_at: string;
  updated_at: string;
}

export interface CreateIntentInput {
  body: string;
}

export interface RecurrenceResult {
  should_recur: boolean;
  reasoning: string;
  next_due: string | null;
  next_due_utc: string | null;
}

export interface RecallMatch {
  intent_id: string;
  description: string;
  completed_at: string | null;
  confidence: number;
}

export type IpcChannels =
  | 'intent:create'
  | 'intent:list'
  | 'intent:update'
  | 'intent:delete'
  | 'intent:dismiss-recurrence'
  | 'settings:get'
  | 'settings:set'
  | 'models:list'
  | 'window:hide';
