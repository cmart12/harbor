export interface Intent {
  id: string;
  description: string;
  client: string | null;
  due_at: string | null;
  status: 'captured' | 'in_progress' | 'done';
  created_at: string;
  updated_at: string;
}

export interface CreateIntentInput {
  description: string;
  client?: string;
  due_at?: string;
}

export type IpcChannels =
  | 'intent:create'
  | 'intent:list'
  | 'intent:update'
  | 'intent:delete'
  | 'settings:get'
  | 'settings:set'
  | 'models:list'
  | 'window:hide';
