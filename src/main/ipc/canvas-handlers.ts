import { ipcMain, shell, BrowserWindow } from 'electron';
import { isInitialized, getSpace, getSkill, assignSpaceFolder, updateCanvasContent } from '../database';
import { getConfigValue } from '../config';
import { initSpaceCanvas, readCanvas, writeCanvas, scheduleAutoCommit, saveAttachment, resolveAttachmentPath, getMimeType, readSpaceFile, getSpaceHistory, restoreSpaceVersion, getSpaceVersionContent, resolveSpaceFolder, createPage, readPage, writePage, listPages } from '../workspace';
import { parseFrontmatter, serializeFrontmatter } from '../frontmatter';
import { fetchLinkPreview } from '../services/link-preview';
import { startWatching, stopWatching, markSelfWrite } from '../canvas-watcher';
import { merge3 } from '../../shared/text-merge';
import type { SkillFrontmatter } from '../../shared/types';
import * as fs from 'fs';
import * as path from 'path';

const CANVAS_FILE = 'canvas.md';

/**
 * Track the last content the editor read/wrote for each space.
 * Used to detect if an agent modified the file between editor saves.
 */
const lastEditorContent = new Map<string, string>();

export function registerCanvasHandlers(): void {
  ipcMain.handle('canvas:read', (_event, spaceId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { content: '', error: 'no_workspace' };

    // Route page reads to page files
    if (spaceId.startsWith('__page__')) {
      const rest = spaceId.slice('__page__'.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx > 0) {
        const realSpaceId = rest.slice(0, slashIdx);
        const pageName = rest.slice(slashIdx + 1);
        const space = getSpace(realSpaceId);
        if (!space) return { content: '', error: 'not_found' };
        let folder = space.folder;
        if (!folder) {
          folder = initSpaceCanvas(workspace, realSpaceId, space.description, space.body);
          assignSpaceFolder(realSpaceId, folder);
        }
        const result = readPage(workspace, folder, pageName);
        if ('error' in result) return { content: '', error: result.error };
        return { content: result.content };
      }
    }

    const space = getSpace(spaceId);
    if (!space) return { content: '', error: 'not_found' };

    // Ensure folder exists (for spaces created before canvas feature)
    let folder = space.folder;
    if (!folder) {
      folder = initSpaceCanvas(workspace, spaceId, space.description, space.body);
      assignSpaceFolder(spaceId, folder);
    }

    const content = readCanvas(workspace, folder);
    lastEditorContent.set(spaceId, content);

    // Start watching for external changes (e.g. from agents)
    const folderRoot = resolveSpaceFolder(workspace, folder);
    const canvasPath = path.join(folderRoot, CANVAS_FILE);
    startWatching(spaceId, canvasPath, (newContent: string) => {
      lastEditorContent.set(spaceId, newContent);
      updateCanvasContent(spaceId, newContent);
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('canvas:content-updated', { spaceId, content: newContent });
      }
    });

    return { content };
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

    // Route page autosaves to the page file
    if (spaceId.startsWith('__page__')) {
      const rest = spaceId.slice('__page__'.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx > 0) {
        const realSpaceId = rest.slice(0, slashIdx);
        const pageName = rest.slice(slashIdx + 1);
        const space = getSpace(realSpaceId);
        if (!space) return { error: 'not_found' };
        let folder = space.folder;
        if (!folder) {
          folder = initSpaceCanvas(workspace, realSpaceId, space.description, space.body);
          assignSpaceFolder(realSpaceId, folder);
        }
        const result = writePage(workspace, folder, pageName, content);
        if ('error' in result) return { error: result.error };
        return { success: true };
      }
    }

    const space = getSpace(spaceId);
    if (!space) return { error: 'not_found' };

    let folder = space.folder;
    if (!folder) {
      folder = initSpaceCanvas(workspace, spaceId, space.description, space.body);
      assignSpaceFolder(spaceId, folder);
    }

    // Check if the file has been modified by an agent since the editor last synced.
    // If so, merge the editor's content with the disk content before writing.
    const canvasPath = path.join(workspace, folder, CANVAS_FILE);
    let contentToWrite = content;
    try {
      const diskContent = fs.readFileSync(canvasPath, 'utf-8');
      const lastKnown = lastEditorContent.get(spaceId);
      if (lastKnown !== undefined && diskContent !== lastKnown && diskContent !== content) {
        // Disk was modified externally — merge editor changes with disk changes
        const { merged } = merge3(lastKnown, content, diskContent);
        contentToWrite = merged;
      }
    } catch { /* file may not exist; proceed with editor content */ }

    markSelfWrite(spaceId, contentToWrite);
    writeCanvas(workspace, folder, contentToWrite);
    updateCanvasContent(spaceId, contentToWrite);
    lastEditorContent.set(spaceId, contentToWrite);
    return { success: true, content: contentToWrite !== content ? contentToWrite : undefined };
  });

  // Save canvas + trigger a commit (called when leaving the canvas)
  ipcMain.handle('canvas:close', (_event, spaceId: string, content: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return;

    // Route page closes to page files
    if (spaceId.startsWith('__page__')) {
      const rest = spaceId.slice('__page__'.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx > 0) {
        const realSpaceId = rest.slice(0, slashIdx);
        const pageName = rest.slice(slashIdx + 1);
        const space = getSpace(realSpaceId);
        if (!space) return;
        let folder = space.folder;
        if (!folder) {
          folder = initSpaceCanvas(workspace, realSpaceId, space.description, space.body);
          assignSpaceFolder(realSpaceId, folder);
        }
        writePage(workspace, folder, pageName, content);
        scheduleAutoCommit(workspace);
        return;
      }
    }

    // Stop watching — user is leaving this canvas
    stopWatching(spaceId);

    const space = getSpace(spaceId);
    if (!space) return;

    let folder = space.folder;
    if (!folder) {
      folder = initSpaceCanvas(workspace, spaceId, space.description, space.body);
      assignSpaceFolder(spaceId, folder);
    }

    writeCanvas(workspace, folder, content);
    updateCanvasContent(spaceId, content);
    lastEditorContent.delete(spaceId);
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

    shell.openPath(resolveSpaceFolder(workspace, space.folder));
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

  // ── Child pages ──────────────────────────────────────────
  ipcMain.handle('canvas:create-page', (_event, spaceId: string, pageName: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { success: false, page: '', error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space) return { success: false, page: '', error: 'not_found' };

    let folder = space.folder;
    if (!folder) {
      folder = initSpaceCanvas(workspace, spaceId, space.description, space.body);
      assignSpaceFolder(spaceId, folder);
    }

    const result = createPage(workspace, folder, pageName);
    if ('error' in result) return { success: false, page: '', error: result.error };

    scheduleAutoCommit(workspace);
    return { success: true, page: result.page };
  });

  ipcMain.handle('canvas:read-page', (_event, spaceId: string, pageName: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { content: '', error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space) return { content: '', error: 'not_found' };

    let folder = space.folder;
    if (!folder) {
      folder = initSpaceCanvas(workspace, spaceId, space.description, space.body);
      assignSpaceFolder(spaceId, folder);
    }

    const result = readPage(workspace, folder, pageName);
    if ('error' in result) return { content: '', error: result.error };
    return { content: result.content };
  });

  ipcMain.handle('canvas:write-page', (_event, spaceId: string, pageName: string, content: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space) return { error: 'not_found' };

    let folder = space.folder;
    if (!folder) {
      folder = initSpaceCanvas(workspace, spaceId, space.description, space.body);
      assignSpaceFolder(spaceId, folder);
    }

    const result = writePage(workspace, folder, pageName, content);
    if ('error' in result) return { error: result.error };
    return { success: true };
  });

  ipcMain.handle('canvas:close-page', (_event, spaceId: string, pageName: string, content: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space) return { error: 'not_found' };

    let folder = space.folder;
    if (!folder) {
      folder = initSpaceCanvas(workspace, spaceId, space.description, space.body);
      assignSpaceFolder(spaceId, folder);
    }

    const result = writePage(workspace, folder, pageName, content);
    if ('error' in result) return { error: result.error };
    scheduleAutoCommit(workspace);
    return { success: true };
  });

  ipcMain.handle('canvas:list-pages', (_event, spaceId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { pages: [], error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space) return { pages: [], error: 'not_found' };

    let folder = space.folder;
    if (!folder) {
      folder = initSpaceCanvas(workspace, spaceId, space.description, space.body);
      assignSpaceFolder(spaceId, folder);
    }

    return { pages: listPages(workspace, folder) };
  });
}
