import * as fs from 'fs';
import * as path from 'path';
import { updateCanvasContent } from '../database';
import { markSelfWrite } from '../canvas-watcher';
import { notifyAllWindows } from '../notify';
import { resolveSpaceFolder, writeCanvas } from '../workspace';
import { merge3 } from '../../shared/text-merge';

const CANVAS_FILE = 'canvas.md';

/**
 * Last content an editor read or wrote, keyed by real space id. Used to merge
 * external agent edits instead of blindly overwriting disk content.
 */
const lastEditorContent = new Map<string, string>();

export function rememberCanvasEditorContent(spaceId: string, content: string): void {
  lastEditorContent.set(spaceId, content);
}

export function forgetCanvasEditorContent(spaceId: string): void {
  lastEditorContent.delete(spaceId);
}

export interface MainCanvasWriteResult {
  success: true;
  /** Present when disk/editor content was merged and differs from the caller's input. */
  content?: string;
}

export function writeMainCanvasWithMerge(
  workspace: string,
  spaceId: string,
  folder: string,
  content: string,
): MainCanvasWriteResult {
  const canvasPath = path.join(resolveSpaceFolder(workspace, folder), CANVAS_FILE);
  let contentToWrite = content;

  try {
    const diskContent = fs.readFileSync(canvasPath, 'utf-8');
    const lastKnown = lastEditorContent.get(spaceId);
    if (lastKnown !== undefined && diskContent !== lastKnown && diskContent !== content) {
      contentToWrite = merge3(lastKnown, content, diskContent).merged;
    }
  } catch {
    // File may not exist yet; proceed with editor content.
  }

  markSelfWrite(spaceId, contentToWrite);
  writeCanvas(workspace, folder, contentToWrite);
  const titleUpdate = updateCanvasContent(spaceId, contentToWrite);
  if (titleUpdate?.titleChanged) {
    notifyAllWindows('space:title-updated', { spaceId, title: titleUpdate.title });
  }
  lastEditorContent.set(spaceId, contentToWrite);

  return { success: true, content: contentToWrite !== content ? contentToWrite : undefined };
}
