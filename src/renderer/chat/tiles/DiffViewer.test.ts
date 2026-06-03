import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from './DiffViewer';

describe('parseUnifiedDiff', () => {
  it('returns null for empty/non-diff input', () => {
    expect(parseUnifiedDiff('')).toBeNull();
    expect(parseUnifiedDiff('just some text')).toBeNull();
  });

  it('parses a new file diff', () => {
    const input = [
      'diff --git a/src b/src',
      'new file mode 100644',
      'index 0000000..0000000',
      '--- /dev/null',
      '+++ b/src',
      '@@ -0,0 +1,4 @@',
      '+assets',
      '+main',
      '+renderer',
      '+shared',
    ].join('\n');

    const parsed = parseUnifiedDiff(input);
    expect(parsed).not.toBeNull();
    expect(parsed!.files).toHaveLength(1);

    const file = parsed!.files[0];
    expect(file.kind).toBe('added');
    expect(file.newPath).toBe('src');
    expect(file.added).toBe(4);
    expect(file.removed).toBe(0);
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0];
    expect(hunk.lines).toHaveLength(4);
    expect(hunk.lines[0]).toMatchObject({ kind: 'add', text: 'assets', newNum: 1 });
    expect(hunk.lines[3]).toMatchObject({ kind: 'add', text: 'shared', newNum: 4 });

    expect(parsed!.added).toBe(4);
    expect(parsed!.removed).toBe(0);
  });

  it('parses a modified file with context lines and assigns line numbers', () => {
    const input = [
      'diff --git a/foo.ts b/foo.ts',
      'index aaaaaaa..bbbbbbb 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -10,5 +10,6 @@ function foo() {',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' return a + b;',
      ' }',
    ].join('\n');

    const parsed = parseUnifiedDiff(input);
    expect(parsed).not.toBeNull();
    const file = parsed!.files[0];
    expect(file.kind).toBe('modified');
    expect(file.added).toBe(2);
    expect(file.removed).toBe(1);

    const hunk = file.hunks[0];
    expect(hunk.section).toBe('function foo() {');
    expect(hunk.oldStart).toBe(10);
    expect(hunk.newStart).toBe(10);

    // context line: same number on both sides
    expect(hunk.lines[0]).toMatchObject({ kind: 'context', oldNum: 10, newNum: 10 });
    // remove advances only oldNum
    expect(hunk.lines[1]).toMatchObject({ kind: 'remove', oldNum: 11 });
    expect(hunk.lines[1].newNum).toBeUndefined();
    // add advances only newNum
    expect(hunk.lines[2]).toMatchObject({ kind: 'add', newNum: 11 });
    expect(hunk.lines[2].oldNum).toBeUndefined();
    expect(hunk.lines[3]).toMatchObject({ kind: 'add', newNum: 12 });
    // following context picks up correctly: old advanced past one removal, new past two adds
    expect(hunk.lines[4]).toMatchObject({ kind: 'context', oldNum: 12, newNum: 13 });
  });

  it('parses multiple files in one diff', () => {
    const input = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,1 +1,1 @@',
      '-x',
      '+y',
      'diff --git a/b.ts b/b.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/b.ts',
      '@@ -0,0 +1,1 @@',
      '+hello',
    ].join('\n');

    const parsed = parseUnifiedDiff(input);
    expect(parsed!.files).toHaveLength(2);
    expect(parsed!.files[0].kind).toBe('modified');
    expect(parsed!.files[1].kind).toBe('added');
    expect(parsed!.added).toBe(2);
    expect(parsed!.removed).toBe(1);
  });

  it('handles deleted files', () => {
    const input = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
    ].join('\n');

    const parsed = parseUnifiedDiff(input);
    expect(parsed!.files[0].kind).toBe('deleted');
    expect(parsed!.files[0].removed).toBe(2);
  });

  it('ignores "\\ No newline at end of file" markers', () => {
    const input = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1,1 +1,1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
    ].join('\n');
    const parsed = parseUnifiedDiff(input);
    expect(parsed!.files[0].hunks[0].lines).toHaveLength(2);
    expect(parsed!.files[0].added).toBe(1);
    expect(parsed!.files[0].removed).toBe(1);
  });
});
