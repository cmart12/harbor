import { ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { isInitialized, listSkills, getSkill, upsertSkill, removeSkill, createIntent, assignIntentFolder } from '../database';
import { getConfigValue } from '../config';
import { parseFrontmatter, serializeFrontmatter } from '../frontmatter';
import { getSkillsDir, syncAllSkills } from '../skill-watcher';
import { createIntentFolder, scheduleAutoCommit } from '../workspace';
import type { SkillFrontmatter, Skill } from '../../shared/types';

const SKILL_FILE = 'SKILL.md';

export function registerSkillHandlers(): void {
  ipcMain.handle('skill:list', () => {
    if (!isInitialized()) return [];
    return listSkills();
  });

  ipcMain.handle('skill:read', (_event, skillId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const skill = getSkill(skillId);
    if (!skill) return { error: 'not_found' };

    try {
      const content = fs.readFileSync(skill.filePath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(content);
      return { frontmatter, body };
    } catch {
      return { error: 'read_failed' };
    }
  });

  ipcMain.handle('skill:write', (_event, skillId: string, frontmatter: Record<string, unknown>, body: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const skill = getSkill(skillId);
    if (!skill) return { error: 'not_found' };

    try {
      const content = serializeFrontmatter(frontmatter as SkillFrontmatter, body);
      fs.writeFileSync(skill.filePath, content, 'utf-8');
      // The file watcher will pick up the change and re-index
      return { success: true };
    } catch {
      return { error: 'write_failed' };
    }
  });

  ipcMain.handle('skill:create', (_event, name: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    // Slugify the name for the folder
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'new-skill';

    const skillsDir = getSkillsDir(workspace);
    const folderPath = path.join(skillsDir, slug);

    if (fs.existsSync(folderPath)) {
      return { error: 'already_exists' };
    }

    fs.mkdirSync(folderPath, { recursive: true });

    const filePath = path.join(folderPath, SKILL_FILE);
    const content = serializeFrontmatter(
      { name, description: '' } as SkillFrontmatter,
      '\n'
    );
    fs.writeFileSync(filePath, content, 'utf-8');

    // The watcher will pick it up, but we can also index immediately
    const now = new Date().toISOString();
    const skill: Skill = {
      id: slug,
      name,
      description: '',
      folder: path.join('.agents/skills', slug),
      filePath,
      created_at: now,
      updated_at: now,
    };
    upsertSkill(skill);
    return skill;
  });

  ipcMain.handle('skill:delete', (_event, skillId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return false;

    const skill = getSkill(skillId);
    if (!skill) return false;

    const folderPath = path.join(workspace, skill.folder);
    try {
      fs.rmSync(folderPath, { recursive: true, force: true });
      removeSkill(skillId);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('skill:open-folder', (_event, skillId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return;

    const skill = getSkill(skillId);
    if (!skill) return;

    shell.openPath(path.join(workspace, skill.folder));
  });

  ipcMain.handle('skill:create-from-prompt', async (_event, description: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const { launchQuickAgent } = await import('../agent-service');
    const skillsDir = getSkillsDir(workspace);

    // List existing skill slugs so the agent avoids collisions
    const existingSlugs = listSkills().map(s => s.id);
    const existingNote = existingSlugs.length > 0
      ? `\nExisting skill folders (DO NOT overwrite these): ${existingSlugs.join(', ')}`
      : '';

    const systemPrompt = [
      'You are a skill template generator. The user will give you a short description of a skill they want to create.',
      'Your job is to:',
      '1. Choose a short, descriptive name for the skill (e.g. "Issue Triage", "PR Review", "Release Notes")',
      '2. Choose a unique kebab-case slug for the folder name (e.g. "issue-triage", "pr-review", "release-notes")',
      '3. Write a concise one-line description',
      '4. Write a detailed SKILL.md body with instructions for how an agent should perform this skill',
      '',
      `Create the skill folder and SKILL.md file inside: ${skillsDir}`,
      'The folder structure must be: {skills-dir}/{slug}/SKILL.md',
      existingNote,
      'IMPORTANT: Never overwrite an existing skill folder. Choose a unique slug.',
      '',
      'The SKILL.md file MUST have this exact format:',
      '```',
      '---',
      'name: <skill name>',
      "description: '<one-line description>'",
      '---',
      '',
      '<detailed instructions for the skill>',
      '```',
      '',
      'Create the folder and write the file. Do not ask for confirmation.',
    ].join('\n');

    const result = await launchQuickAgent(
      `${systemPrompt}\n\nUser description: ${description}`,
      workspace,
    );

    return result;
  });

  ipcMain.handle('skill:create-intent', (_event, skillId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const skill = getSkill(skillId);
    if (!skill) return { error: 'not_found' };

    // Create a new intent with the skill name as description, linked to the source skill
    const intent = createIntent({ body: skill.name }, skillId);

    // Create the intent folder
    const folder = createIntentFolder(workspace, intent.id, skill.name);
    assignIntentFolder(intent.id, folder);
    intent.folder = folder;

    // Copy skill folder contents to the intent folder
    const skillFolderPath = path.join(workspace, skill.folder);
    const intentFolderPath = path.join(workspace, folder);

    copyDirContents(skillFolderPath, intentFolderPath);

    // Rename SKILL.md → canvas.md in the intent folder
    const skillMdPath = path.join(intentFolderPath, SKILL_FILE);
    const canvasMdPath = path.join(intentFolderPath, 'canvas.md');
    if (fs.existsSync(skillMdPath)) {
      // Read the skill file, strip frontmatter, write as canvas.md
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const { body } = parseFrontmatter(content);
      fs.writeFileSync(canvasMdPath, body, 'utf-8');
      fs.unlinkSync(skillMdPath);
    }

    scheduleAutoCommit(workspace);
    return intent;
  });

  ipcMain.handle('skill:launch', async (_event, skillId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const skill = getSkill(skillId);
    if (!skill) return { error: 'not_found' };

    // Create the intent from the skill (same as skill:create-intent)
    const intent = createIntent({ body: skill.name }, skillId);

    const folder = createIntentFolder(workspace, intent.id, skill.name);
    assignIntentFolder(intent.id, folder);
    intent.folder = folder;

    const skillFolderPath = path.join(workspace, skill.folder);
    const intentFolderPath = path.join(workspace, folder);

    copyDirContents(skillFolderPath, intentFolderPath);

    const skillMdPath = path.join(intentFolderPath, SKILL_FILE);
    const canvasMdPath = path.join(intentFolderPath, 'canvas.md');
    if (fs.existsSync(skillMdPath)) {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const { body } = parseFrontmatter(content);
      fs.writeFileSync(canvasMdPath, body, 'utf-8');
      fs.unlinkSync(skillMdPath);
    }

    scheduleAutoCommit(workspace);

    // Also launch a session on the new intent
    const { launchSession } = await import('../session');
    launchSession(intent.id, workspace);

    return intent;
  });
}

/** Recursively copy directory contents (not the directory itself). */
function copyDirContents(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      copyDirContents(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
