import * as fs from 'fs';
import * as path from 'path';
import { parseFrontmatter } from './frontmatter';
import { upsertSkill, removeSkill, listSkills } from './database';
import { pickEmoji } from './emoji-picker';
import type { Skill, SkillFrontmatter, SkillScheduleFrequency } from '../shared/types';
import { BrowserWindow } from 'electron';

const SKILLS_DIR = '.agents/skills';
const SKILL_FILE = 'SKILL.md';
const DEBOUNCE_MS = 500;

let watcher: fs.FSWatcher | null = null;
let workspaceRoot: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Get the absolute path to the skills directory. */
export function getSkillsDir(wsRoot: string): string {
  return path.join(wsRoot, SKILLS_DIR);
}

/** Ensure the .agents/skills/ directory exists. */
export function ensureSkillsDir(wsRoot: string): void {
  const dir = getSkillsDir(wsRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Parse a single skill folder into a Skill object. Returns null if SKILL.md is missing/invalid. */
function parseSkillFolder(wsRoot: string, folderName: string): Skill | null {
  const folderPath = path.join(wsRoot, SKILLS_DIR, folderName);
  const filePath = path.join(folderPath, SKILL_FILE);

  if (!fs.existsSync(filePath)) return null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const { frontmatter } = parseFrontmatter<SkillFrontmatter>(content);

  const name = frontmatter.name || folderName;
  const description = frontmatter.description || '';
  const emoji = typeof frontmatter.emoji === 'string' && frontmatter.emoji
    ? frontmatter.emoji
    : pickEmoji(name, description);

  // Parse schedule fields from frontmatter
  const validFrequencies: SkillScheduleFrequency[] = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly'];
  const schedule = typeof frontmatter.schedule === 'string' && validFrequencies.includes(frontmatter.schedule as SkillScheduleFrequency)
    ? frontmatter.schedule as SkillScheduleFrequency
    : null;
  const schedule_time = typeof frontmatter.schedule_time === 'string' && /^\d{2}:\d{2}$/.test(frontmatter.schedule_time)
    ? frontmatter.schedule_time
    : null;
  const schedule_day = typeof frontmatter.schedule_day === 'number' && frontmatter.schedule_day >= 0 && frontmatter.schedule_day <= 6
    ? frontmatter.schedule_day
    : null;

  return {
    id: folderName,
    name,
    description,
    emoji,
    folder: path.join(SKILLS_DIR, folderName),
    filePath,
    schedule,
    schedule_time,
    schedule_day,
    next_run_at: null,
    last_run_at: null,
    created_at: stat.birthtime.toISOString(),
    updated_at: stat.mtime.toISOString(),
  };
}

/** Scan all skill folders and sync DB state. */
export function syncAllSkills(wsRoot: string): void {
  const skillsDir = getSkillsDir(wsRoot);
  if (!fs.existsSync(skillsDir)) return;

  let entries: string[];
  try {
    entries = fs.readdirSync(skillsDir);
  } catch {
    return;
  }

  const foundIds = new Set<string>();

  for (const entry of entries) {
    const entryPath = path.join(skillsDir, entry);
    try {
      if (!fs.statSync(entryPath).isDirectory()) continue;
    } catch {
      continue;
    }

    const skill = parseSkillFolder(wsRoot, entry);
    if (skill) {
      upsertSkill(skill);
      foundIds.add(skill.id);
    }
  }

  // Remove skills from DB that no longer exist on disk
  const existing = listSkills();
  for (const skill of existing) {
    if (!foundIds.has(skill.id)) {
      removeSkill(skill.id);
    }
  }

  notifyRenderer();
}

/** Notify the renderer that the skill list changed. */
function notifyRenderer(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('skills:changed');
  }
}

/** Handle a filesystem change event — debounced re-sync. */
function onFsChange(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (workspaceRoot) {
      syncAllSkills(workspaceRoot);
    }
  }, DEBOUNCE_MS);
}

/** Start watching the .agents/skills/ directory for changes. */
export function startSkillWatcher(wsRoot: string): void {
  stopSkillWatcher();
  workspaceRoot = wsRoot;

  ensureSkillsDir(wsRoot);

  // Initial sync
  syncAllSkills(wsRoot);

  const skillsDir = getSkillsDir(wsRoot);
  try {
    watcher = fs.watch(skillsDir, { recursive: true }, (_eventType, _filename) => {
      onFsChange();
    });
    watcher.on('error', (err) => {
      console.warn('[skill-watcher] Watch error:', err.message);
    });
    console.log(`[skill-watcher] Watching ${skillsDir}`);
  } catch (err: any) {
    console.warn('[skill-watcher] Failed to start watcher:', err.message);
  }
}

/** Stop watching for skill changes. */
export function stopSkillWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  workspaceRoot = null;
}
