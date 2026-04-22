export interface Attachment {
  type: 'url' | 'file';
  name: string;
  url: string;
  /** Relative path within the intent folder (for type: 'file') */
  relativePath?: string;
  /** MIME type of the file */
  mimeType?: string;
}

export interface CanvasAgent {
  id: string;
  intent_id: string;
  selected_text: string;
  session_id: string;
  pid: number | null;
  status: 'running' | 'waiting-approval' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface AgentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface LinkPreviewMeta {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
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
