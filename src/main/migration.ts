import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { appendEvent } from './eventlog';
import { getLogPath } from './workspace';
import { setConfigValue, loadConfig } from './config';

const OLD_DB_PATH = path.join(app.getPath('userData'), 'spaces.db');

/**
 * Migrate data from the old userData DB to the new workspace event log.
 * Idempotent: skips if the event log already has content.
 */
export function migrateOldDatabase(workspaceRoot: string): void {
  if (!fs.existsSync(OLD_DB_PATH)) return;

  const logPath = getLogPath(workspaceRoot);

  // Skip if log already has events (migration already done or fresh data exists)
  if (fs.existsSync(logPath) && fs.statSync(logPath).size > 0) {
    console.log('[migration] Event log already has content, skipping migration');
    return;
  }

  console.log('[migration] Migrating old database to workspace event log...');

  let oldDb: InstanceType<typeof Database>;
  try {
    oldDb = new Database(OLD_DB_PATH, { readonly: true });
  } catch (err) {
    console.error('[migration] Failed to open old database:', err);
    return;
  }

  try {
    // Read all intents
    const intents = oldDb.prepare(
      `SELECT id, description, raw_text, client, due_at, due_at_utc, recurrence, completed_at, status, created_at, updated_at
       FROM intents`
    ).all() as any[];

    // Read all space events
    let intentEvents: any[] = [];
    try {
      intentEvents = oldDb.prepare(
        `SELECT id, space_id, event_type, due_at, due_at_utc, completed_at, recurrence_json, created_at
         FROM intent_events`
      ).all() as any[];
    } catch {
      // Table might not exist in very old DBs
    }

    // Migrate settings to config.json
    try {
      const settings = oldDb.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
      for (const s of settings) {
        if (s.key === 'theme') setConfigValue('theme', s.value as 'light' | 'dark');
        if (s.key === 'model') setConfigValue('model', s.value);
        // workspace_root is already set (user just selected the workspace)
      }

      // Migrate session_ids from old intents into config.sessions
      const intentsWithSessions = oldDb.prepare(
        `SELECT id, session_id FROM intents WHERE session_id IS NOT NULL`
      ).all() as { id: string; session_id: string }[];

      const config = loadConfig();
      for (const i of intentsWithSessions) {
        if (!config.sessions[i.id]) {
          config.sessions[i.id] = i.session_id;
        }
      }
      setConfigValue('sessions', config.sessions);
    } catch {
      // settings table might not exist
    }

    // Write snapshot event
    let migrationSucceeded = false;
    if (intents.length > 0 || intentEvents.length > 0) {
      try {
        appendEvent(logPath, 'snapshot', {
          intents: intents.map(i => ({ ...i, folder: null })),
          intent_events: intentEvents,
        });
        migrationSucceeded = true;
        console.log(`[migration] Exported ${intents.length} intents and ${intentEvents.length} events`);
      } catch (err) {
        console.error('[migration] Failed to write snapshot event — aborting migration to protect data:', err);
        return;
      }
    } else {
      migrationSucceeded = true;
    }

    // Only rename old DB after successful log write
    if (migrationSucceeded) {
      const backupPath = OLD_DB_PATH + '.migrated';
      fs.renameSync(OLD_DB_PATH, backupPath);
      for (const suffix of ['-journal', '-wal', '-shm']) {
        const f = OLD_DB_PATH + suffix;
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      console.log(`[migration] Old database backed up to ${backupPath}`);
    }
  } catch (err) {
    console.error('[migration] Migration failed:', err);
  } finally {
    oldDb.close();
  }
}
