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

export interface AgentSession {
  id: string;
  session_id: string;
  intent_id: string | null;
  prompt: string;
  status: 'running' | 'waiting-approval' | 'completed' | 'failed';
  summary: string;
  working_dir: string | null;
  source: 'sdk' | 'cli' | 'cloud';
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

// ── Canvas target (popout window) ───────────────────────

export type CanvasTarget =
  | { kind: 'intent'; id: string; title: string }
  | { kind: 'skill'; id: string; title: string };

// ── Skills ──────────────────────────────────────────────

export interface SkillFrontmatter {
  name: string;
  description: string;
  [key: string]: unknown;
}

export interface Skill {
  /** Folder name inside .agents/skills/ (e.g. "pdf-processing") — used as primary key */
  id: string;
  name: string;
  description: string;
  /** Relative folder path from workspace root (e.g. ".agents/skills/pdf-processing") */
  folder: string;
  /** Absolute path to the SKILL.md file */
  filePath: string;
  created_at: string;
  updated_at: string;
}

export interface SkillContent {
  frontmatter: SkillFrontmatter;
  body: string;
}
