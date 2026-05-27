import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { appendEvent, replayLog } from './eventlog';

let tmpDir: string;
let logPath: string;
let db: Database.Database;

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE spaces (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      body TEXT,
      raw_text TEXT,
      client TEXT,
      due_at TEXT,
      due_at_utc TEXT,
      recurrence TEXT,
      completed_at TEXT,
      folder TEXT,
      session_id TEXT,
      source_skill_id TEXT,
      attachments TEXT DEFAULT '[]',
      canvas_content TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'captured',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE canvas_agents (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      selected_text TEXT NOT NULL,
      session_id TEXT NOT NULL,
      pid INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      space_id TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      summary TEXT DEFAULT '',
      working_dir TEXT,
      source TEXT NOT NULL DEFAULT 'sdk',
      persona_handle TEXT,
      quoted_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE space_events (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      due_at TEXT,
      due_at_utc TEXT,
      completed_at TEXT,
      recurrence_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
    )
  `);
}

/** Write raw lines directly to the log file (for testing replayLog). */
function writeLog(lines: object[]): void {
  const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(logPath, content, 'utf-8');
}

function getSpace(id: string): any {
  return db.prepare('SELECT * FROM spaces WHERE id = ?').get(id);
}

function allSpaces(): any[] {
  return db.prepare('SELECT * FROM spaces').all();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventlog-test-'));
  logPath = path.join(tmpDir, 'events.jsonl');
  db = new Database(':memory:');
  createSchema(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── appendEvent ───────────────────────────────────────────

describe('appendEvent', () => {
  it('writes a JSON line with ts, op, and data fields', () => {
    appendEvent(logPath, 'space.create', { id: 'abc' });

    const content = fs.readFileSync(logPath, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed).toHaveProperty('ts');
    expect(parsed.op).toBe('space.create');
    expect(parsed.data).toEqual({ id: 'abc' });
    expect(new Date(parsed.ts).toISOString()).toBe(parsed.ts);
  });

  it('appends to existing file content without overwriting', () => {
    appendEvent(logPath, 'space.create', { id: '1' });
    appendEvent(logPath, 'space.create', { id: '2' });

    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).data.id).toBe('1');
    expect(JSON.parse(lines[1]).data.id).toBe('2');
  });

  it('ends each line with a newline', () => {
    appendEvent(logPath, 'space.create', { id: '1' });

    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('creates the file if it does not exist', () => {
    const newPath = path.join(tmpDir, 'new-events.jsonl');
    expect(fs.existsSync(newPath)).toBe(false);

    appendEvent(newPath, 'test.op', { x: 1 });

    expect(fs.existsSync(newPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(newPath, 'utf-8').trim());
    expect(parsed.op).toBe('test.op');
  });
});

// ── replayLog ─────────────────────────────────────────────

describe('replayLog', () => {
  it('handles missing log file gracefully', () => {
    const missing = path.join(tmpDir, 'does-not-exist.jsonl');
    expect(() => replayLog(missing, db)).not.toThrow();
    expect(allSpaces()).toHaveLength(0);
  });

  it('handles empty log file gracefully', () => {
    fs.writeFileSync(logPath, '', 'utf-8');
    expect(() => replayLog(logPath, db)).not.toThrow();
    expect(allSpaces()).toHaveLength(0);
  });

  // ── space.create ─────────────────────────────────────

  describe('space.create', () => {
    it('inserts an space into the database', () => {
      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'space.create',
        data: {
          id: 'i1', description: 'Test space', body: 'Full body',
          raw_text: 'raw', client: 'web', due_at: null, due_at_utc: null,
          recurrence: null, completed_at: null, folder: null,
          attachments: '[]', status: 'captured',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      }]);

      replayLog(logPath, db);
      const space = getSpace('i1');
      expect(space).toBeTruthy();
      expect(space.description).toBe('Test space');
      expect(space.body).toBe('Full body');
      expect(space.status).toBe('captured');
      expect(space.client).toBe('web');
    });

    it('defaults status to "captured" when not provided', () => {
      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'space.create',
        data: {
          id: 'i2', description: 'No status',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      }]);

      replayLog(logPath, db);
      expect(getSpace('i2').status).toBe('captured');
    });

    it('backfills body from raw_text when body is missing', () => {
      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'space.create',
        data: {
          id: 'i3', description: 'Old event', raw_text: 'raw text value',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      }]);

      replayLog(logPath, db);
      expect(getSpace('i3').body).toBe('raw text value');
    });

    it('backfills body from description when body and raw_text are missing', () => {
      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'space.create',
        data: {
          id: 'i4', description: 'Just description',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      }]);

      replayLog(logPath, db);
      expect(getSpace('i4').body).toBe('Just description');
    });

    it('sets body to empty string when body and raw_text are null and description is present', () => {
      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'space.create',
        data: {
          id: 'i5', description: 'Has description',
          body: null, raw_text: null,
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      }]);

      replayLog(logPath, db);
      // body ?? raw_text ?? description ?? '' → null ?? null ?? 'Has description' → 'Has description'
      expect(getSpace('i5').body).toBe('Has description');
    });
  });

  // ── space.update ─────────────────────────────────────

  describe('space.update', () => {
    beforeEach(() => {
      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'space.create',
        data: {
          id: 'u1', description: 'Original', body: 'Original body',
          status: 'captured',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      }]);
      replayLog(logPath, db);
    });

    it('updates allowed fields on an space', () => {
      writeLog([
        {
          ts: '2024-01-01T00:00:00.000Z',
          op: 'space.create',
          data: {
            id: 'u1', description: 'Original', body: 'Original body',
            status: 'captured',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          ts: '2024-01-02T00:00:00.000Z',
          op: 'space.update',
          data: { id: 'u1', fields: { description: 'Updated', status: 'in_progress' } },
        },
      ]);

      // Re-create DB for clean replay
      db.exec('DELETE FROM spaces');
      replayLog(logPath, db);

      const space = getSpace('u1');
      expect(space.description).toBe('Updated');
      expect(space.status).toBe('in_progress');
      expect(space.body).toBe('Original body');
    });

    it('skips unknown fields with a warning but does not crash', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      writeLog([
        {
          ts: '2024-01-01T00:00:00.000Z',
          op: 'space.create',
          data: {
            id: 'u1', description: 'Original', body: 'Body',
            status: 'captured',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          ts: '2024-01-02T00:00:00.000Z',
          op: 'space.update',
          data: {
            id: 'u1',
            fields: { description: 'Updated', not_a_real_field: 'bad', another_fake: 123 },
          },
        },
      ]);

      db.exec('DELETE FROM spaces');
      expect(() => replayLog(logPath, db)).not.toThrow();

      const space = getSpace('u1');
      expect(space.description).toBe('Updated');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping unknown field')
      );

      warnSpy.mockRestore();
    });

    it('does nothing when update has only unknown fields', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      writeLog([
        {
          ts: '2024-01-01T00:00:00.000Z',
          op: 'space.create',
          data: {
            id: 'u1', description: 'Original', body: 'Body',
            status: 'captured',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          ts: '2024-01-02T00:00:00.000Z',
          op: 'space.update',
          data: { id: 'u1', fields: { totally_fake: 'nope' } },
        },
      ]);

      db.exec('DELETE FROM spaces');
      expect(() => replayLog(logPath, db)).not.toThrow();
      expect(getSpace('u1').description).toBe('Original');

      warnSpy.mockRestore();
    });
  });

  // ── space.delete ─────────────────────────────────────

  describe('space.delete', () => {
    it('removes an space from the database', () => {
      writeLog([
        {
          ts: '2024-01-01T00:00:00.000Z',
          op: 'space.create',
          data: {
            id: 'd1', description: 'To delete', body: '',
            status: 'captured',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          ts: '2024-01-02T00:00:00.000Z',
          op: 'space.delete',
          data: { id: 'd1' },
        },
      ]);

      replayLog(logPath, db);
      expect(getSpace('d1')).toBeUndefined();
    });
  });

  // ── space.assign_folder ──────────────────────────────

  describe('space.assign_folder', () => {
    it('updates folder and sets updated_at from event timestamp', () => {
      writeLog([
        {
          ts: '2024-01-01T00:00:00.000Z',
          op: 'space.create',
          data: {
            id: 'f1', description: 'Folder test', body: '',
            status: 'captured',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          ts: '2024-06-15T12:00:00.000Z',
          op: 'space.assign_folder',
          data: { id: 'f1', folder: '/workspace/projects/cool' },
        },
      ]);

      replayLog(logPath, db);
      const space = getSpace('f1');
      expect(space.folder).toBe('/workspace/projects/cool');
      expect(space.updated_at).toBe('2024-06-15T12:00:00.000Z');
    });
  });

  // ── Event ordering ────────────────────────────────────

  describe('event ordering', () => {
    it('create → update → delete produces correct final state', () => {
      writeLog([
        {
          ts: '2024-01-01T00:00:00.000Z',
          op: 'space.create',
          data: {
            id: 'ord1', description: 'Created', body: '',
            status: 'captured',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          ts: '2024-01-02T00:00:00.000Z',
          op: 'space.update',
          data: { id: 'ord1', fields: { description: 'Updated', status: 'in_progress' } },
        },
        {
          ts: '2024-01-03T00:00:00.000Z',
          op: 'space.delete',
          data: { id: 'ord1' },
        },
      ]);

      replayLog(logPath, db);
      expect(getSpace('ord1')).toBeUndefined();
      expect(allSpaces()).toHaveLength(0);
    });
  });

  // ── snapshot ──────────────────────────────────────────

  describe('snapshot', () => {
    it('bulk-loads spaces from snapshot', () => {
      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'snapshot',
        data: {
          spaces: [
            {
              id: 's1', description: 'Snap one', body: 'Body 1', status: 'captured',
              created_at: '2024-01-01T00:00:00.000Z',
              updated_at: '2024-01-01T00:00:00.000Z',
            },
            {
              id: 's2', description: 'Snap two', body: 'Body 2', status: 'done',
              created_at: '2024-01-01T00:00:00.000Z',
              updated_at: '2024-01-01T00:00:00.000Z',
            },
          ],
        },
      }]);

      replayLog(logPath, db);
      expect(allSpaces()).toHaveLength(2);
      expect(getSpace('s1').description).toBe('Snap one');
      expect(getSpace('s2').status).toBe('done');
    });

    it('bulk-loads space_events from snapshot', () => {
      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'snapshot',
        data: {
          spaces: [{
            id: 'si1', description: 'Parent', body: '', status: 'captured',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          }],
          space_events: [
            {
              id: 'ie1', space_id: 'si1', event_type: 'due_date_set',
              due_at: '2024-02-01', due_at_utc: '2024-02-01T00:00:00Z',
              created_at: '2024-01-01T00:00:00.000Z',
            },
            {
              id: 'ie2', space_id: 'si1', event_type: 'completed',
              completed_at: '2024-02-15T12:00:00Z',
              created_at: '2024-01-15T00:00:00.000Z',
            },
          ],
        },
      }]);

      replayLog(logPath, db);
      const events = db.prepare('SELECT * FROM space_events ORDER BY created_at').all() as any[];
      expect(events).toHaveLength(2);
      expect(events[0].id).toBe('ie1');
      expect(events[0].due_at).toBe('2024-02-01');
      expect(events[1].id).toBe('ie2');
      expect(events[1].completed_at).toBe('2024-02-15T12:00:00Z');
    });

    it('snapshot without spaces or space_events does not error', () => {
      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'snapshot',
        data: {},
      }]);

      expect(() => replayLog(logPath, db)).not.toThrow();
      expect(allSpaces()).toHaveLength(0);
    });
  });

  // ── Corruption tolerance ──────────────────────────────

  describe('corruption tolerance', () => {
    it('ignores a corrupt final line', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const goodLine = JSON.stringify({
        ts: '2024-01-01T00:00:00.000Z',
        op: 'space.create',
        data: {
          id: 'c1', description: 'Good', body: '',
          status: 'captured',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      });
      fs.writeFileSync(logPath, goodLine + '\n' + '{corrupt json\n', 'utf-8');

      expect(() => replayLog(logPath, db)).not.toThrow();
      expect(getSpace('c1')).toBeTruthy();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring corrupt final line')
      );

      warnSpy.mockRestore();
    });

    it('throws on corrupt line in the middle (with valid lines after)', () => {
      const goodLine1 = JSON.stringify({
        ts: '2024-01-01T00:00:00.000Z',
        op: 'space.create',
        data: {
          id: 'c2', description: 'First', body: '',
          status: 'captured',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      });
      const goodLine2 = JSON.stringify({
        ts: '2024-01-02T00:00:00.000Z',
        op: 'space.create',
        data: {
          id: 'c3', description: 'Third', body: '',
          status: 'captured',
          created_at: '2024-01-02T00:00:00.000Z',
          updated_at: '2024-01-02T00:00:00.000Z',
        },
      });

      fs.writeFileSync(
        logPath,
        goodLine1 + '\n' + '{broken' + '\n' + goodLine2 + '\n',
        'utf-8',
      );

      expect(() => replayLog(logPath, db)).toThrow(/Corrupt event log at line 2/);
    });
  });

  // ── intent_event.log ──────────────────────────────────

  describe('intent_event.log', () => {
    it('inserts an space event into space_events table', () => {
      writeLog([
        {
          ts: '2024-01-01T00:00:00.000Z',
          op: 'space.create',
          data: {
            id: 'ie-parent', description: 'Parent', body: '',
            status: 'captured',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          ts: '2024-01-02T00:00:00.000Z',
          op: 'intent_event.log',
          data: {
            id: 'evt1', space_id: 'ie-parent', event_type: 'due_date_set',
            due_at: '2024-03-01', due_at_utc: '2024-03-01T00:00:00Z',
            completed_at: null, recurrence_json: null,
            created_at: '2024-01-02T00:00:00.000Z',
          },
        },
      ]);

      replayLog(logPath, db);
      const evt = db.prepare('SELECT * FROM space_events WHERE id = ?').get('evt1') as any;
      expect(evt).toBeTruthy();
      expect(evt.space_id).toBe('ie-parent');
      expect(evt.event_type).toBe('due_date_set');
      expect(evt.due_at).toBe('2024-03-01');
      expect(evt.due_at_utc).toBe('2024-03-01T00:00:00Z');
    });
  });

  // ── canvas_agent events ───────────────────────────────

  describe('canvas_agent.created', () => {
    it('inserts a canvas agent into the database', () => {
      writeLog([
        {
          ts: '2024-01-01T00:00:00.000Z',
          op: 'space.create',
          data: {
            id: 'ca-parent', description: 'Parent', body: '',
            status: 'captured',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          ts: '2024-01-02T00:00:00.000Z',
          op: 'canvas_agent.created',
          data: {
            id: 'ca1', space_id: 'ca-parent', selected_text: 'Fix the bug',
            session_id: 'sess-1', pid: 12345, status: 'running',
            created_at: '2024-01-02T00:00:00.000Z',
            updated_at: '2024-01-02T00:00:00.000Z',
          },
        },
      ]);

      replayLog(logPath, db);
      const agent = db.prepare('SELECT * FROM canvas_agents WHERE id = ?').get('ca1') as any;
      expect(agent).toBeTruthy();
      expect(agent.space_id).toBe('ca-parent');
      expect(agent.selected_text).toBe('Fix the bug');
      expect(agent.session_id).toBe('sess-1');
      expect(agent.pid).toBe(12345);
      expect(agent.status).toBe('running');
    });

    it('inserts without pid (null)', () => {
      writeLog([
        {
          ts: '2024-01-01T00:00:00.000Z',
          op: 'space.create',
          data: {
            id: 'ca-parent2', description: 'Parent', body: '',
            status: 'captured',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          ts: '2024-01-02T00:00:00.000Z',
          op: 'canvas_agent.created',
          data: {
            id: 'ca2', space_id: 'ca-parent2', selected_text: 'Some text',
            session_id: 'sess-2', status: 'running',
            created_at: '2024-01-02T00:00:00.000Z',
            updated_at: '2024-01-02T00:00:00.000Z',
          },
        },
      ]);

      replayLog(logPath, db);
      const agent = db.prepare('SELECT * FROM canvas_agents WHERE id = ?').get('ca2') as any;
      expect(agent).toBeTruthy();
      expect(agent.pid).toBeNull();
    });
  });

  describe('canvas_agent.updated', () => {
    function seedCanvasAgent(): void {
      writeLog([
        {
          ts: '2024-01-01T00:00:00.000Z',
          op: 'space.create',
          data: {
            id: 'cau-parent', description: 'Parent', body: '',
            status: 'captured',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          ts: '2024-01-02T00:00:00.000Z',
          op: 'canvas_agent.created',
          data: {
            id: 'cau1', space_id: 'cau-parent', selected_text: 'Text',
            session_id: 'sess-x', pid: null, status: 'running',
            created_at: '2024-01-02T00:00:00.000Z',
            updated_at: '2024-01-02T00:00:00.000Z',
          },
        },
      ]);
    }

    it('updates status and updated_at without pid', () => {
      seedCanvasAgent();
      // Append the update line
      const lines = fs.readFileSync(logPath, 'utf-8');
      const updateLine = JSON.stringify({
        ts: '2024-01-03T00:00:00.000Z',
        op: 'canvas_agent.updated',
        data: { id: 'cau1', status: 'completed', updated_at: '2024-01-03T00:00:00.000Z' },
      });
      fs.writeFileSync(logPath, lines + updateLine + '\n', 'utf-8');

      replayLog(logPath, db);
      const agent = db.prepare('SELECT * FROM canvas_agents WHERE id = ?').get('cau1') as any;
      expect(agent.status).toBe('completed');
      expect(agent.updated_at).toBe('2024-01-03T00:00:00.000Z');
      expect(agent.pid).toBeNull();
    });

    it('updates status, pid, and updated_at when pid is provided', () => {
      seedCanvasAgent();
      const lines = fs.readFileSync(logPath, 'utf-8');
      const updateLine = JSON.stringify({
        ts: '2024-01-03T00:00:00.000Z',
        op: 'canvas_agent.updated',
        data: {
          id: 'cau1', status: 'running', pid: 9999,
          updated_at: '2024-01-03T00:00:00.000Z',
        },
      });
      fs.writeFileSync(logPath, lines + updateLine + '\n', 'utf-8');

      replayLog(logPath, db);
      const agent = db.prepare('SELECT * FROM canvas_agents WHERE id = ?').get('cau1') as any;
      expect(agent.status).toBe('running');
      expect(agent.pid).toBe(9999);
    });
  });

  // ── agent_session events ──────────────────────────────

  describe('agent_session.created', () => {
    it('inserts an agent session into the database', () => {
      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'agent_session.created',
        data: {
          id: 'as1', session_id: 'sid-1', space_id: 'some-space',
          prompt: 'Fix all bugs', status: 'running',
          summary: 'Fixing bugs', working_dir: '/home/user/project',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      }]);

      replayLog(logPath, db);
      const sess = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get('as1') as any;
      expect(sess).toBeTruthy();
      expect(sess.session_id).toBe('sid-1');
      expect(sess.space_id).toBe('some-space');
      expect(sess.prompt).toBe('Fix all bugs');
      expect(sess.status).toBe('running');
      expect(sess.summary).toBe('Fixing bugs');
      expect(sess.working_dir).toBe('/home/user/project');
    });

    it('defaults summary to empty string and working_dir to null', () => {
      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'agent_session.created',
        data: {
          id: 'as2', session_id: 'sid-2', prompt: 'Run tests', status: 'running',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      }]);

      replayLog(logPath, db);
      const sess = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get('as2') as any;
      expect(sess.summary).toBe('');
      expect(sess.working_dir).toBeNull();
      expect(sess.space_id).toBeNull();
    });
  });

  describe('agent_session.updated', () => {
    beforeEach(() => {
      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'agent_session.created',
        data: {
          id: 'asu1', session_id: 'sid-u', prompt: 'Original', status: 'running',
          summary: '', working_dir: null,
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      }]);
      replayLog(logPath, db);
    });

    it('updates status without summary', () => {
      const lines = fs.readFileSync(logPath, 'utf-8');
      fs.writeFileSync(logPath, lines + JSON.stringify({
        ts: '2024-01-02T00:00:00.000Z',
        op: 'agent_session.updated',
        data: { id: 'asu1', status: 'completed', updated_at: '2024-01-02T00:00:00.000Z' },
      }) + '\n', 'utf-8');

      // Replay from scratch
      db.exec('DELETE FROM agent_sessions');
      replayLog(logPath, db);

      const sess = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get('asu1') as any;
      expect(sess.status).toBe('completed');
      expect(sess.summary).toBe('');
    });

    it('updates status and summary when summary is provided', () => {
      const lines = fs.readFileSync(logPath, 'utf-8');
      fs.writeFileSync(logPath, lines + JSON.stringify({
        ts: '2024-01-02T00:00:00.000Z',
        op: 'agent_session.updated',
        data: {
          id: 'asu1', status: 'completed',
          summary: 'All tests passed', updated_at: '2024-01-02T00:00:00.000Z',
        },
      }) + '\n', 'utf-8');

      db.exec('DELETE FROM agent_sessions');
      replayLog(logPath, db);

      const sess = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get('asu1') as any;
      expect(sess.status).toBe('completed');
      expect(sess.summary).toBe('All tests passed');
    });
  });

  // ── Unknown ops ───────────────────────────────────────

  describe('unknown event op', () => {
    it('logs a warning but does not crash', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      writeLog([{
        ts: '2024-01-01T00:00:00.000Z',
        op: 'totally.unknown.operation',
        data: { id: 'x' },
      }]);

      expect(() => replayLog(logPath, db)).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown event op: totally.unknown.operation')
      );

      warnSpy.mockRestore();
    });
  });

  // ── Idempotent replay ─────────────────────────────────

  describe('idempotent replay', () => {
    it('replaying the same log twice produces the same state (INSERT OR REPLACE)', () => {
      writeLog([
        {
          ts: '2024-01-01T00:00:00.000Z',
          op: 'space.create',
          data: {
            id: 'idem1', description: 'Idempotent', body: 'Test body',
            status: 'captured',
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        },
        {
          ts: '2024-01-02T00:00:00.000Z',
          op: 'space.update',
          data: { id: 'idem1', fields: { description: 'Updated idem' } },
        },
      ]);

      replayLog(logPath, db);
      const first = getSpace('idem1');

      // Replay again on same DB
      replayLog(logPath, db);
      const second = getSpace('idem1');

      expect(second).toEqual(first);
      expect(allSpaces()).toHaveLength(1);
    });
  });
});
