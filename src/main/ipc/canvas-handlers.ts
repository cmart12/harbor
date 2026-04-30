import { ipcMain, shell } from 'electron';
import { isInitialized, getSpace, getSkill, assignSpaceFolder, updateCanvasContent } from '../database';
import { getConfigValue } from '../config';
import { initSpaceCanvas, readCanvas, writeCanvas, scheduleAutoCommit, saveAttachment, resolveAttachmentPath, getMimeType, readSpaceFile, getSpaceHistory, restoreSpaceVersion, getSpaceVersionContent } from '../workspace';
import { parseFrontmatter, serializeFrontmatter } from '../frontmatter';
import { fetchLinkPreview } from '../services/link-preview';
import type { SkillFrontmatter } from '../../shared/types';
import * as fs from 'fs';
import * as path from 'path';

export function registerCanvasHandlers(): void {
  ipcMain.handle('canvas:read', (_event, spaceId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { content: '', error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space) return { content: '', error: 'not_found' };

    // Ensure folder exists (for spaces created before canvas feature)
    let folder = space.folder;
    if (!folder) {
      folder = initSpaceCanvas(workspace, spaceId, space.description, space.body);
      assignSpaceFolder(spaceId, folder);
    }

    return { content: readCanvas(workspace, folder) };
  });

  ipcMain.handle('canvas:write', (_event, spaceId: string, content: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    // Route skill autosaves to the skill file
    if (spaceId.startsWith('__skill__')) {
      const skillId = spaceId.slice('__skill__'.length);
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

    const space = getSpace(spaceId);
    if (!space) return { error: 'not_found' };

    let folder = space.folder;
    if (!folder) {
      folder = initSpaceCanvas(workspace, spaceId, space.description, space.body);
      assignSpaceFolder(spaceId, folder);
    }

    writeCanvas(workspace, folder, content);
    updateCanvasContent(spaceId, content);
    return { success: true };
  });

  // Save canvas + trigger a commit (called when leaving the canvas)
  ipcMain.handle('canvas:close', (_event, spaceId: string, content: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return;

    const space = getSpace(spaceId);
    if (!space) return;

    let folder = space.folder;
    if (!folder) {
      folder = initSpaceCanvas(workspace, spaceId, space.description, space.body);
      assignSpaceFolder(spaceId, folder);
    }

    writeCanvas(workspace, folder, content);
    updateCanvasContent(spaceId, content);
    scheduleAutoCommit(workspace);
  });

  // ── Canvas file paste ─────────────────────────────────
  ipcMain.handle('canvas:paste-file', (_event, spaceId: string, filename: string, dataArray: number[]) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space) return { error: 'not_found' };

    let folder = space.folder;
    if (!folder) {
      folder = initSpaceCanvas(workspace, spaceId, space.description, space.body);
      assignSpaceFolder(spaceId, folder);
    }

    const data = Buffer.from(dataArray);
    const result = saveAttachment(workspace, folder, filename, data);
    return result;
  });

  // ── Attachment file serving ───────────────────────────
  ipcMain.handle('canvas:resolve-attachment', (_event, spaceId: string, relativePath: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space || !space.folder) return { error: 'not_found' };

    const absPath = resolveAttachmentPath(workspace, space.folder, relativePath);
    if (!absPath) return { error: 'not_found' };

    const mimeType = getMimeType(absPath);
    return { path: absPath, mimeType };
  });

  // ── Read file from space folder (for documint storage) ──
  ipcMain.handle('canvas:read-file', (_event, spaceId: string, relativePath: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space || !space.folder) return { error: 'not_found' };

    const result = readSpaceFile(workspace, space.folder, relativePath);
    if (!result) return { error: 'not_found' };

    // Return as array of bytes + mimeType so it can cross the IPC boundary
    return { data: Array.from(result.data), mimeType: result.mimeType };
  });

  // ── Open space folder in OS file manager ─────────────
  ipcMain.handle('canvas:open-folder', (_event, spaceId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return;

    const space = getSpace(spaceId);
    if (!space || !space.folder) return;

    shell.openPath(path.join(workspace, space.folder));
  });

  // ── Link preview ──────────────────────────────────────
  ipcMain.handle('canvas:fetch-link-meta', async (_event, url: string) => {
    return fetchLinkPreview(url);
  });

  // ── Canvas history ──────────────────────────────────────
  ipcMain.handle('canvas:history', async (_event, spaceId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { commits: [], error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space || !space.folder) return { commits: [], error: 'not_found' };

    const commits = await getSpaceHistory(workspace, space.folder);
    return { commits };
  });

  ipcMain.handle('canvas:restore', async (_event, spaceId: string, sha: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { success: false, error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space || !space.folder) return { success: false, error: 'not_found' };

    const result = await restoreSpaceVersion(workspace, space.folder, sha);
    if (result.success) {
      // Re-read canvas and update DB
      const content = readCanvas(workspace, space.folder);
      updateCanvasContent(spaceId, content);
    }
    return result;
  });

  ipcMain.handle('canvas:preview-version', async (_event, spaceId: string, sha: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { content: '', error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space || !space.folder) return { content: '', error: 'not_found' };

    return getSpaceVersionContent(workspace, space.folder, sha);
  });

  ipcMain.handle('canvas:read-activity-log', async (_event, spaceId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { events: [], error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space || !space.folder) return { events: [], error: 'not_found' };

    const { readSpaceActivityLog } = await import('../space-eventlog');
    return { events: readSpaceActivityLog(workspace, space.folder) };
  });
}
