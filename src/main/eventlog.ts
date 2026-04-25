import * as fs from 'fs';
import Database from 'better-sqlite3';

export interface LogEvent {
  ts: string;
  op: string;
  data: Record<string, any>;
}

const ALLOWED_INTENT_FIELDS = new Set([
  'description', 'body', 'raw_text', 'client', 'due_at', 'due_at_utc',
  'recurrence', 'completed_at', 'folder', 'status', 'created_at', 'updated_at',
  'attachments',
]);

export function appendEvent(logPath: string, op: string, data: Record<string, any>): void {
  const event: LogEvent = {
    ts: new Date().toISOString(),
    op,
    data,
  };
  const line = JSON.stringify(event) + '\n';
  const fd = fs.openSync(logPath, 'a');
  try {
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function replayLog(logPath: string, db: Database.Database): void {
  if (!fs.existsSync(logPath)) return;

  const content = fs.readFileSync(logPath, 'utf-8');
  const lines = content.split('\n');

  const replay = db.transaction(() => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const event: LogEvent = JSON.parse(line);
        applyEvent(db, event);
      } catch (err) {
        // Only tolerate corruption on the final line (crash during append)
        const remaining = lines.slice(i + 1).some(l => l.trim());
        if (!remaining) {
          console.warn(`[eventlog] Ignoring corrupt final line ${i + 1}`);
        } else {
          throw new Error(`Corrupt event log at line ${i + 1}: ${(err as Error).message}`);
        }
      }
    }
  });

  replay();
}

function applyEvent(db: Database.Database, event: LogEvent): void {
  switch (event.op) {
    case 'intent.create': {
      const d = event.data;
      // Backfill body from raw_text/description for old events
      const body = d.body ?? d.raw_text ?? d.description ?? '';
      db.prepare(
        `INSERT OR REPLACE INTO intents (id, description, body, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, attachments, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        d.id, d.description, body, d.raw_text ?? null, d.client ?? null,
        d.due_at ?? null, d.due_at_utc ?? null, d.recurrence ?? null,
        d.completed_at ?? null, d.folder ?? null, d.attachments ?? '[]',
        d.status ?? 'captured',
        d.created_at, d.updated_at,
      );
      break;
    }

    case 'intent.update': {
      const d = event.data;
      const fields = d.fields || {};
      const sets: string[] = [];
      const values: any[] = [];

      for (const [key, val] of Object.entries(fields)) {
        if (!ALLOWED_INTENT_FIELDS.has(key)) {
          console.warn(`[eventlog] Skipping unknown field in update: ${key}`);
          continue;
        }
        sets.push(`${key} = ?`);
        values.push(val ?? null);
      }

      if (sets.length > 0) {
        values.push(d.id);
        db.prepare(`UPDATE intents SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      }
      break;
    }

    case 'intent.assign_folder': {
      const d = event.data;
      db.prepare('UPDATE intents SET folder = ?, updated_at = ? WHERE id = ?')
        .run(d.folder, event.ts, d.id);
      break;
    }

    case 'intent.delete': {
      db.prepare('DELETE FROM intents WHERE id = ?').run(event.data.id);
      break;
    }

    case 'intent_event.log': {
      const d = event.data;
      db.prepare(
        `INSERT OR REPLACE INTO intent_events (id, intent_id, event_type, due_at, due_at_utc, completed_at, recurrence_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        d.id, d.intent_id, d.event_type,
        d.due_at ?? null, d.due_at_utc ?? null,
        d.completed_at ?? null, d.recurrence_json ?? null,
        d.created_at,
      );
      break;
    }

    case 'canvas_agent.created': {
      const d = event.data;
      db.prepare(
        `INSERT OR REPLACE INTO canvas_agents (id, intent_id, selected_text, session_id, pid, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(d.id, d.intent_id, d.selected_text, d.session_id, d.pid ?? null, d.status, d.created_at, d.updated_at);
      break;
    }

    case 'canvas_agent.updated': {
      const d = event.data;
      if (d.pid !== undefined && d.pid !== null) {
        db.prepare('UPDATE canvas_agents SET status = ?, pid = ?, updated_at = ? WHERE id = ?')
          .run(d.status, d.pid, d.updated_at, d.id);
      } else {
        db.prepare('UPDATE canvas_agents SET status = ?, updated_at = ? WHERE id = ?')
          .run(d.status, d.updated_at, d.id);
      }
      break;
    }

    case 'agent_session.created': {
      const d = event.data;
      db.prepare(
        `INSERT OR REPLACE INTO agent_sessions (id, session_id, intent_id, prompt, status, summary, working_dir, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        d.id, d.session_id, d.intent_id ?? null, d.prompt, d.status,
        d.summary ?? '', d.working_dir ?? null, d.source ?? 'sdk', d.created_at, d.updated_at,
      );
      break;
    }

    case 'agent_session.updated': {
      const d = event.data;
      if (d.summary !== undefined && d.summary !== null) {
        db.prepare('UPDATE agent_sessions SET status = ?, summary = ?, updated_at = ? WHERE id = ?')
          .run(d.status, d.summary, d.updated_at, d.id);
      } else {
        db.prepare('UPDATE agent_sessions SET status = ?, updated_at = ? WHERE id = ?')
          .run(d.status, d.updated_at, d.id);
      }
      break;
    }

    case 'snapshot': {
      const d = event.data;
      if (d.intents) {
        for (const intent of d.intents) {
          const body = intent.body ?? intent.raw_text ?? intent.description ?? '';
          db.prepare(
            `INSERT OR REPLACE INTO intents (id, description, body, raw_text, client, due_at, due_at_utc, recurrence, completed_at, folder, attachments, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            intent.id, intent.description, body, intent.raw_text ?? null, intent.client ?? null,
            intent.due_at ?? null, intent.due_at_utc ?? null, intent.recurrence ?? null,
            intent.completed_at ?? null, intent.folder ?? null, intent.attachments ?? '[]',
            intent.status,
            intent.created_at, intent.updated_at,
          );
        }
      }
      if (d.intent_events) {
        for (const evt of d.intent_events) {
          db.prepare(
            `INSERT OR REPLACE INTO intent_events (id, intent_id, event_type, due_at, due_at_utc, completed_at, recurrence_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            evt.id, evt.intent_id, evt.event_type,
            evt.due_at ?? null, evt.due_at_utc ?? null,
            evt.completed_at ?? null, evt.recurrence_json ?? null,
            evt.created_at,
          );
        }
      }
      break;
    }

    default:
      console.warn(`[eventlog] Unknown event op: ${event.op}`);
  }
}
