import { beforeEach, describe, expect, it, vi } from 'vitest';
import { merge3 } from '../../shared/text-merge';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('../database', () => ({
  updateCanvasContent: vi.fn(),
}));

vi.mock('../canvas-watcher', () => ({
  markSelfWrite: vi.fn(),
}));

vi.mock('../workspace', () => ({
  resolveSpaceFolder: vi.fn((workspace: string, folder: string) => `${workspace}/${folder}`),
  writeCanvas: vi.fn(),
}));

import * as fs from 'fs';
import { updateCanvasContent } from '../database';
import { markSelfWrite } from '../canvas-watcher';
import { writeCanvas } from '../workspace';
import { rememberCanvasEditorContent, writeMainCanvasWithMerge } from './canvas-editor-state';

describe('canvas editor write state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges external disk changes with editor changes before writing', () => {
    const base = 'title\nbody\n';
    const editor = 'title edited\nbody\n';
    const disk = 'title\nbody from agent\n';
    const expected = merge3(base, editor, disk).merged;

    rememberCanvasEditorContent('space-1', base);
    vi.mocked(fs.readFileSync).mockReturnValueOnce(disk);

    const result = writeMainCanvasWithMerge('/workspace', 'space-1', 'space-folder', editor);

    expect(result).toEqual({ success: true, content: expected });
    expect(markSelfWrite).toHaveBeenCalledWith('space-1', expected);
    expect(writeCanvas).toHaveBeenCalledWith('/workspace', 'space-folder', expected);
    expect(updateCanvasContent).toHaveBeenCalledWith('space-1', expected);
  });

  it('writes editor content directly when no editor snapshot exists', () => {
    vi.mocked(fs.readFileSync).mockReturnValueOnce('disk changed');

    const result = writeMainCanvasWithMerge('/workspace', 'space-2', 'space-folder', 'editor');

    expect(result).toEqual({ success: true, content: undefined });
    expect(writeCanvas).toHaveBeenCalledWith('/workspace', 'space-folder', 'editor');
  });
});
