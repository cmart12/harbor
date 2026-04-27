import { ipcMain } from 'electron';
import { isInitialized, getIntent, getSkill, assignIntentFolder, updateCanvasContent } from '../database';
import { getConfigValue } from '../config';
import { initIntentCanvas, readCanvas, writeCanvas, scheduleAutoCommit, saveAttachment, resolveAttachmentPath, getMimeType, getIntentHistory, restoreIntentVersion, getIntentVersionContent } from '../workspace';
import { parseFrontmatter, serializeFrontmatter } from '../frontmatter';
import { fetchLinkPreview } from '../services/link-preview';
import type { SkillFrontmatter } from '../../shared/types';
import * as fs from 'fs';

export function registerCanvasHandlers(): void {
  ipcMain.handle('canvas:read', (_event, intentId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { content: '', error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent) return { content: '', error: 'not_found' };

    // Ensure folder exists (for intents created before canvas feature)
    let folder = intent.folder;
    if (!folder) {
      folder = initIntentCanvas(workspace, intentId, intent.description, intent.body);
      assignIntentFolder(intentId, folder);
    }

    return { content: readCanvas(workspace, folder) };
  });

  ipcMain.handle('canvas:write', (_event, intentId: string, content: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    // Route skill autosaves to the skill file
    if (intentId.startsWith('__skill__')) {
      const skillId = intentId.slice('__skill__'.length);
      const skill = getSkill(skillId);
      if (!skill) return { error: 'not_found' };
      try {
        const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(content);
        const fileContent = serializeFrontmatter(frontmatter, body);
        fs.writeFileSync(skill.filePath, fileContent, 'utf-8');
        return { success: true };
      } catch {
        return { error: 'write_failed' };
      }
    }

    const intent = getIntent(intentId);
    if (!intent) return { error: 'not_found' };

    let folder = intent.folder;
    if (!folder) {
      folder = initIntentCanvas(workspace, intentId, intent.description, intent.body);
      assignIntentFolder(intentId, folder);
    }

    writeCanvas(workspace, folder, content);
    updateCanvasContent(intentId, content);
    return { success: true };
  });

  // Save canvas + trigger a commit (called when leaving the canvas)
  ipcMain.handle('canvas:close', (_event, intentId: string, content: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return;

    const intent = getIntent(intentId);
    if (!intent) return;

    let folder = intent.folder;
    if (!folder) {
      folder = initIntentCanvas(workspace, intentId, intent.description, intent.body);
      assignIntentFolder(intentId, folder);
    }

    writeCanvas(workspace, folder, content);
    updateCanvasContent(intentId, content);
    scheduleAutoCommit(workspace);
  });

  // ── Canvas file paste ─────────────────────────────────
  ipcMain.handle('canvas:paste-file', (_event, intentId: string, filename: string, dataArray: number[]) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent) return { error: 'not_found' };

    let folder = intent.folder;
    if (!folder) {
      folder = initIntentCanvas(workspace, intentId, intent.description, intent.body);
      assignIntentFolder(intentId, folder);
    }

    const data = Buffer.from(dataArray);
    const result = saveAttachment(workspace, folder, filename, data);
    return result;
  });

  // ── Attachment file serving ───────────────────────────
  ipcMain.handle('canvas:resolve-attachment', (_event, intentId: string, relativePath: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent || !intent.folder) return { error: 'not_found' };

    const absPath = resolveAttachmentPath(workspace, intent.folder, relativePath);
    if (!absPath) return { error: 'not_found' };

    const mimeType = getMimeType(absPath);
    return { path: absPath, mimeType };
  });

  // ── Link preview ──────────────────────────────────────
  ipcMain.handle('canvas:fetch-link-meta', async (_event, url: string) => {
    return fetchLinkPreview(url);
  });

  // ── Canvas history ──────────────────────────────────────
  ipcMain.handle('canvas:history', async (_event, intentId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { commits: [], error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent || !intent.folder) return { commits: [], error: 'not_found' };

    const commits = await getIntentHistory(workspace, intent.folder);
    return { commits };
  });

  ipcMain.handle('canvas:restore', async (_event, intentId: string, sha: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { success: false, error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent || !intent.folder) return { success: false, error: 'not_found' };

    const result = await restoreIntentVersion(workspace, intent.folder, sha);
    if (result.success) {
      // Re-read canvas and update DB
      const content = readCanvas(workspace, intent.folder);
      updateCanvasContent(intentId, content);
    }
    return result;
  });

  ipcMain.handle('canvas:preview-version', async (_event, intentId: string, sha: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { content: '', error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent || !intent.folder) return { content: '', error: 'not_found' };

    return getIntentVersionContent(workspace, intent.folder, sha);
  });
}
