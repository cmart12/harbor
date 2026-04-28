/**
 * Per-intent activity log — writes to {intentFolder}/.intent/events.jsonl
 * Append-only log for debugging agent activity on a canvas.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface IntentActivityEvent {
  ts: string;
  type: string;
  [key: string]: any;
}

/** Get the activity log path for an intent folder. */
export function getIntentActivityLogPath(workspaceRoot: string, intentFolder: string): string {
  return path.join(workspaceRoot, intentFolder, '.intent', 'events.jsonl');
}

/** Append an event to the per-intent activity log. */
export function appendIntentActivity(workspaceRoot: string, intentFolder: string, type: string, data: Record<string, any>): void {
  if (!workspaceRoot || !intentFolder) return;

  const logDir = path.join(workspaceRoot, intentFolder, '.intent');
  const logPath = path.join(logDir, 'events.jsonl');

  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const event: IntentActivityEvent = {
      ts: new Date().toISOString(),
      type,
      ...data,
    };
    const line = JSON.stringify(event) + '\n';
    const fd = fs.openSync(logPath, 'a');
    try {
      fs.writeSync(fd, line);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Non-fatal — don't break agent execution for logging failures
  }
}

/** Read all events from the per-intent activity log. */
export function readIntentActivityLog(workspaceRoot: string, intentFolder: string): IntentActivityEvent[] {
  const logPath = getIntentActivityLogPath(workspaceRoot, intentFolder);
  if (!fs.existsSync(logPath)) return [];

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const events: IntentActivityEvent[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {
        // Skip corrupt lines
      }
    }
    return events;
  } catch {
    return [];
  }
}
