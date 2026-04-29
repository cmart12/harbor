import { describe, it, expect, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  isReadOnlyCommand,
  createSandboxPreToolHook,
  SANDBOX_SYSTEM_PROMPT,
  IS_WINDOWS,
  isPathInside,
  normalizePath,
  resolvePathPolicy,
  checkPathScope,
  isPathInScope,
  samePath,
  createSandboxPathPolicyHook,
  createSandboxShellDenialHook,
  detectShellSandboxDenial,
  logSandboxLayerDenial,
} from './sandbox-policies';

describe('sandbox-policies', () => {
  describe('IS_WINDOWS', () => {
    it('is a boolean', () => {
      expect(typeof IS_WINDOWS).toBe('boolean');
    });
  });

  describe('isReadOnlyCommand', () => {
    const readOnlyCommands = [
      'ls -la',
      'dir /b',
      'cat file.txt',
      'head -n 10 file.txt',
      'tail -f log.txt',
      'grep -r pattern .',
      'rg pattern',
      'findstr /s pattern *',
      'Select-String -Path *.ts -Pattern test',
      'wc -l file.txt',
      'sort file.txt',
      'diff a.txt b.txt',
      'echo hello',
      'pwd',
      'whoami',
      'hostname',
      'date',
      'git log --oneline',
      'git status',
      'git diff HEAD~1',
      'git show abc123',
      'git blame file.ts',
      'git branch -a',
      'git tag',
      'file myfile.bin',
      'stat file.txt',
      'which node',
      'where node',
      'env',
      'Get-Content file.txt',
      'tree',
      'find . -name "*.ts"',
      'type file.txt',
    ];

    for (const cmd of readOnlyCommands) {
      it(`classifies "${cmd}" as read-only`, () => {
        expect(isReadOnlyCommand(cmd)).toBe(true);
      });
    }

    const writeCommands = [
      'rm -rf /',
      'npm install',
      'pip install requests',
      'git push origin main',
      'git commit -m "test"',
      'mv file1 file2',
      'cp src dst',
      'mkdir new-dir',
      'curl -X POST http://example.com',
      'wget http://example.com',
      'node script.js',
      'python3 script.py',
      'chmod 777 file',
      'chown user file',
      '',
    ];

    for (const cmd of writeCommands) {
      it(`classifies "${cmd}" as NOT read-only`, () => {
        expect(isReadOnlyCommand(cmd)).toBe(false);
      });
    }

    it('handles leading whitespace', () => {
      expect(isReadOnlyCommand('  cat file.txt')).toBe(true);
      expect(isReadOnlyCommand('  rm file.txt')).toBe(false);
    });
  });

  describe('createSandboxPreToolHook', () => {
    const hook = createSandboxPreToolHook();

    it('denies non-read-only shell commands', async () => {
      const result = await hook({ toolName: 'bash', toolArgs: { command: 'npm install' } });
      expect(result).toEqual({
        permissionDecision: 'deny',
        permissionDecisionReason: 'Sandbox mode: only read-only commands are allowed',
      });
    });

    it('allows read-only shell commands', async () => {
      const result = await hook({ toolName: 'bash', toolArgs: { command: 'cat file.txt' } });
      expect(result).toEqual({});
    });

    it('denies non-read-only shell tool', async () => {
      const result = await hook({ toolName: 'shell', toolArgs: { command: 'rm -rf /' } });
      expect(result).toHaveProperty('permissionDecision', 'deny');
    });

    it('passes through non-shell tools', async () => {
      const result = await hook({ toolName: 'file_edit', toolArgs: { path: 'foo.ts' } });
      expect(result).toEqual({});
    });

    it('passes through when command arg is missing', async () => {
      const result = await hook({ toolName: 'bash', toolArgs: {} });
      expect(result).toEqual({});
    });
  });

  describe('SANDBOX_SYSTEM_PROMPT', () => {
    it('contains sandbox mode instructions', () => {
      expect(SANDBOX_SYSTEM_PROMPT).toContain('[SANDBOX MODE]');
      expect(SANDBOX_SYSTEM_PROMPT).toContain('read-only');
    });
  });

  describe('path-policy engine', () => {
    // Use real filesystem paths so realpath() can canonicalize them.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-policy-test-'));
    const intentFolder = path.join(tmpRoot, 'workspace', 'my-intent');
    const sibling = path.join(tmpRoot, 'workspace', 'sibling-intent');
    fs.mkdirSync(intentFolder, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });

    const policy = resolvePathPolicy(intentFolder, {
      scopeToIntentFolder: true,
      extraReadwritePaths: [],
      extraReadonlyPaths: [],
      extraDeniedPaths: [],
    });

    describe('isPathInside', () => {
      it('matches a direct child', () => {
        const child = path.join(intentFolder, 'canvas.md');
        expect(isPathInside(normalizePath(child), policy.intentFolder)).toBe(true);
      });

      it('matches the same path', () => {
        expect(isPathInside(policy.intentFolder, policy.intentFolder)).toBe(true);
      });

      it('rejects a sibling path with prefix overlap', () => {
        // intentFolder = ".../my-intent", look-alike = ".../my-intent-other"
        const lookalike = path.join(tmpRoot, 'workspace', 'my-intent-other');
        fs.mkdirSync(lookalike, { recursive: true });
        expect(isPathInside(normalizePath(lookalike), policy.intentFolder)).toBe(false);
      });

      it('rejects a parent path', () => {
        const parent = path.join(tmpRoot, 'workspace');
        expect(isPathInside(normalizePath(parent), policy.intentFolder)).toBe(false);
      });
    });

    describe('checkPathScope (default policy: intent folder only)', () => {
      it('allows write under the intent folder', () => {
        const child = path.join(intentFolder, 'canvas.md');
        expect(checkPathScope(child, policy, true)).toEqual({ decision: 'allow-rw' });
      });

      it('allows read under the intent folder', () => {
        const child = path.join(intentFolder, 'sub', 'file.txt');
        expect(checkPathScope(child, policy, false)).toEqual({ decision: 'allow-rw' });
      });

      it('denies write to a sibling intent folder', () => {
        const target = path.join(sibling, 'secret.txt');
        expect(checkPathScope(target, policy, true)).toEqual({
          decision: 'deny', reason: 'out-of-scope',
        });
      });

      it('denies read of a sibling intent folder', () => {
        const target = path.join(sibling, 'secret.txt');
        expect(checkPathScope(target, policy, false)).toEqual({
          decision: 'deny', reason: 'out-of-scope',
        });
      });
    });

    describe('checkPathScope with extra paths', () => {
      const tools = path.join(tmpRoot, 'tools');
      fs.mkdirSync(tools, { recursive: true });
      const data = path.join(tmpRoot, 'data');
      fs.mkdirSync(data, { recursive: true });
      const denied = path.join(intentFolder, 'secrets');
      fs.mkdirSync(denied, { recursive: true });

      const richPolicy = resolvePathPolicy(intentFolder, {
        scopeToIntentFolder: true,
        extraReadwritePaths: [tools],
        extraReadonlyPaths: [data],
        extraDeniedPaths: [denied],
      });

      it('allows write under an extra RW path', () => {
        expect(checkPathScope(path.join(tools, 'cli.exe'), richPolicy, true))
          .toEqual({ decision: 'allow-rw' });
      });

      it('allows read under an extra RO path', () => {
        expect(checkPathScope(path.join(data, 'config.json'), richPolicy, false))
          .toEqual({ decision: 'allow-ro' });
      });

      it('denies write to an extra RO path', () => {
        expect(checkPathScope(path.join(data, 'config.json'), richPolicy, true))
          .toEqual({ decision: 'deny', reason: 'out-of-scope' });
      });

      it('denies even read of a path inside denied list (denied wins over RW)', () => {
        // denied list is inside intentFolder which would otherwise be allow-rw
        expect(checkPathScope(path.join(denied, 'apikey.txt'), richPolicy, false))
          .toEqual({ decision: 'deny', reason: 'denied-list' });
      });
    });

    describe('scopeToIntentFolder = false', () => {
      it('does not implicitly RW the intent folder when disabled', () => {
        const noScope = resolvePathPolicy(intentFolder, {
          scopeToIntentFolder: false,
          extraReadwritePaths: [],
          extraReadonlyPaths: [],
          extraDeniedPaths: [],
        });
        expect(checkPathScope(path.join(intentFolder, 'canvas.md'), noScope, true))
          .toEqual({ decision: 'deny', reason: 'out-of-scope' });
      });
    });

    describe('isPathInScope (convenience)', () => {
      it('returns true for in-scope', () => {
        expect(isPathInScope(path.join(intentFolder, 'a.md'), policy, true)).toBe(true);
      });
      it('returns false for out-of-scope', () => {
        expect(isPathInScope(path.join(sibling, 'a.md'), policy, true)).toBe(false);
      });
    });

    describe('samePath / normalizePath', () => {
      it('treats same path as equal across cases on Windows', () => {
        if (!IS_WINDOWS) return;
        expect(samePath('C:\\Foo\\Bar', 'c:\\foo\\bar')).toBe(true);
      });
    });
  });

  describe('createSandboxPathPolicyHook', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-pretool-test-'));
    const intentFolder = path.join(tmpRoot, 'workspace', 'my-intent');
    const sibling = path.join(tmpRoot, 'workspace', 'sibling');
    fs.mkdirSync(intentFolder, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });

    const policy = resolvePathPolicy(intentFolder, {
      scopeToIntentFolder: true,
      extraReadwritePaths: [],
      extraReadonlyPaths: [],
      extraDeniedPaths: [],
    });

    const allowList = { paths: new Set<string>(), resources: new Set<string>(), webFetch: false };
    function makeHook(opts?: { allowWebFetch?: boolean; isDisabled?: boolean; onBlock?: (info: any) => Promise<any> }) {
      return createSandboxPathPolicyHook({
        policy,
        allowWebFetch: opts?.allowWebFetch ?? false,
        isDisabled: () => opts?.isDisabled ?? false,
        allowList: () => allowList,
        onBlock: opts?.onBlock ?? (async () => ({ permissionDecision: 'deny', permissionDecisionReason: 'blocked' })),
      });
    }

    it('allows a view inside the intent folder', async () => {
      const hook = makeHook();
      const r = await hook({ toolName: 'view', toolArgs: { path: path.join(intentFolder, 'canvas.md') } });
      expect(r).toEqual({});
    });

    it('blocks a view outside the intent folder', async () => {
      const blocks: any[] = [];
      const hook = makeHook({ onBlock: async (info) => { blocks.push(info); return { permissionDecision: 'deny' as const }; } });
      const r = await hook({ toolName: 'view', toolArgs: { path: path.join(sibling, 'secret.txt') } });
      expect(r).toEqual({ permissionDecision: 'deny' });
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({ toolName: 'view', kind: 'read', requiresWrite: false });
    });

    it('blocks an edit outside the intent folder', async () => {
      const blocks: any[] = [];
      const hook = makeHook({ onBlock: async (info) => { blocks.push(info); return { permissionDecision: 'deny' as const }; } });
      await hook({ toolName: 'edit', toolArgs: { path: path.join(sibling, 'secret.txt') } });
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({ kind: 'write', requiresWrite: true });
    });

    it('blocks str_replace_editor.create outside scope', async () => {
      const blocks: any[] = [];
      const hook = makeHook({ onBlock: async (info) => { blocks.push(info); return { permissionDecision: 'deny' as const }; } });
      await hook({ toolName: 'str_replace_editor', toolArgs: { command: 'create', path: path.join(sibling, 'a.txt') } });
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({ kind: 'write', requiresWrite: true });
    });

    it('allows str_replace_editor.view inside scope', async () => {
      const hook = makeHook();
      const r = await hook({ toolName: 'str_replace_editor', toolArgs: { command: 'view', path: path.join(intentFolder, 'a.txt') } });
      expect(r).toEqual({});
    });

    it('blocks shell write commands via the read-only classifier', async () => {
      const hook = makeHook();
      const r = await hook({ toolName: 'bash', toolArgs: { command: 'rm -rf foo' } });
      expect((r as any).permissionDecision).toBe('deny');
    });

    it('allows web_fetch when allowWebFetch is true', async () => {
      const hook = makeHook({ allowWebFetch: true });
      const r = await hook({ toolName: 'web_fetch', toolArgs: { url: 'https://example.com' } });
      expect(r).toEqual({});
    });

    it('blocks web_fetch when allowWebFetch is false', async () => {
      const blocks: any[] = [];
      const hook = makeHook({ onBlock: async (info) => { blocks.push(info); return { permissionDecision: 'deny' as const }; } });
      const r = await hook({ toolName: 'web_fetch', toolArgs: { url: 'https://example.com' } });
      expect(r).toEqual({ permissionDecision: 'deny' });
      expect(blocks[0]).toMatchObject({ toolName: 'web_fetch', kind: 'web-fetch', target: 'https://example.com' });
    });

    it('respects per-agent allow list (path)', async () => {
      const allowedPath = path.join(sibling, 'allowed.txt');
      // First call blocks; user "allow-for-session" decision adds to list.
      allowList.paths.add(normalizePath(allowedPath));
      const hook = makeHook();
      const r = await hook({ toolName: 'view', toolArgs: { path: allowedPath } });
      expect(r).toEqual({});
    });

    it('returns {} when sandbox is disabled (passthrough)', async () => {
      const hook = makeHook({ isDisabled: true });
      const r = await hook({ toolName: 'edit', toolArgs: { path: path.join(sibling, 'x.md') } });
      expect(r).toEqual({});
    });

    it('passes through unknown tools', async () => {
      const hook = makeHook();
      const r = await hook({ toolName: 'unknown_tool', toolArgs: { foo: 'bar' } });
      expect(r).toEqual({});
    });

    describe('layer tagging', () => {
      it('tags read-only-classifier denials with host:readonly-classifier', async () => {
        const blocks: any[] = [];
        const hook = makeHook({ onBlock: async (info) => { blocks.push(info); return {}; } });
        // Read-only classifier denies inline; onBlock is NOT invoked for shell
        // denials by the classifier path (it returns deny directly). So we
        // assert the log line and the deny return instead.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const r = await hook({ toolName: 'bash', toolArgs: { command: 'rm -rf foo' } });
        expect((r as any).permissionDecision).toBe('deny');
        const calls = warn.mock.calls.map(c => c.join(' '));
        expect(calls.some(c => c.includes('[sandbox][host:readonly-classifier]'))).toBe(true);
        warn.mockRestore();
      });

      it('tags path-policy denials with host:path-policy', async () => {
        const blocks: any[] = [];
        const hook = makeHook({ onBlock: async (info) => { blocks.push(info); return { permissionDecision: 'deny' as const }; } });
        await hook({ toolName: 'view', toolArgs: { path: path.join(sibling, 'secret.txt') } });
        expect(blocks).toHaveLength(1);
        expect(blocks[0].layer).toBe('host:path-policy');
      });

      it('tags web_fetch denials with host:web-fetch', async () => {
        const blocks: any[] = [];
        const hook = makeHook({ onBlock: async (info) => { blocks.push(info); return { permissionDecision: 'deny' as const }; } });
        await hook({ toolName: 'web_fetch', toolArgs: { url: 'https://example.com' } });
        expect(blocks).toHaveLength(1);
        expect(blocks[0].layer).toBe('host:web-fetch');
      });
    });
  });

  describe('createSandboxShellDenialHook (post-tool MXC denial detector)', () => {
    it('tags MXC denials with mxc:shell-denial-suspected', async () => {
      const blocks: any[] = [];
      const hook = createSandboxShellDenialHook({
        isDisabled: () => false,
        onBlock: async (info) => { blocks.push(info); },
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await hook({
        toolName: 'bash',
        toolArgs: { command: 'Set-Content C:\\Users\\foo\\bar.txt hi' },
        toolResult: { stderr: 'Set-Content : Access is denied. (0xC0000022)' },
      });
      expect(blocks).toHaveLength(1);
      expect(blocks[0].layer).toBe('mxc:shell-denial-suspected');
      const calls = warn.mock.calls.map(c => c.join(' '));
      expect(calls.some(c => c.includes('[sandbox][mxc:shell-denial-suspected]'))).toBe(true);
      warn.mockRestore();
    });

    it('skips when sandbox is disabled', async () => {
      const blocks: any[] = [];
      const hook = createSandboxShellDenialHook({
        isDisabled: () => true,
        onBlock: async (info) => { blocks.push(info); },
      });
      await hook({
        toolName: 'bash',
        toolArgs: { command: 'rm foo' },
        toolResult: { stderr: 'Access is denied' },
      });
      expect(blocks).toHaveLength(0);
    });

    it('skips when no denial markers are present', async () => {
      const blocks: any[] = [];
      const hook = createSandboxShellDenialHook({
        isDisabled: () => false,
        onBlock: async (info) => { blocks.push(info); },
      });
      await hook({
        toolName: 'bash',
        toolArgs: { command: 'echo hi' },
        toolResult: { content: 'hi' },
      });
      expect(blocks).toHaveLength(0);
    });
  });

  describe('logSandboxLayerDenial', () => {
    it('emits a warn line tagged with the layer', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logSandboxLayerDenial('host:permission', { agentId: 'a1', toolName: 't', target: 'C:\\x', reason: 'oos' });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[sandbox][host:permission] agent=a1 tool=t target=C:\\x reason=oos'),
      );
      warn.mockRestore();
    });
  });

  describe('detectShellSandboxDenial', () => {
    it('returns null for non-shell tools', () => {
      expect(detectShellSandboxDenial({ toolName: 'view', toolArgs: {}, toolResult: 'access denied' })).toBeNull();
    });

    it('returns null when result text has no denial markers', () => {
      expect(detectShellSandboxDenial({
        toolName: 'bash',
        toolArgs: { command: 'cat foo.txt' },
        toolResult: 'hello world\nexit code 0',
      })).toBeNull();
    });

    it('detects "Access is denied"', () => {
      const r = detectShellSandboxDenial({
        toolName: 'bash',
        toolArgs: { command: 'echo > C:\\Windows\\foo.txt' },
        toolResult: { content: 'Access is denied.\nexit code 1' },
      });
      expect(r).not.toBeNull();
      expect(r?.command).toBe('echo > C:\\Windows\\foo.txt');
    });

    it('detects "permission denied"', () => {
      const r = detectShellSandboxDenial({
        toolName: 'shell',
        toolArgs: { command: 'rm /etc/passwd' },
        toolResult: 'rm: /etc/passwd: Permission denied',
      });
      expect(r).not.toBeNull();
    });

    it('detects wxc-exec marker', () => {
      const r = detectShellSandboxDenial({
        toolName: 'bash',
        toolArgs: { command: 'foo' },
        toolResult: { detailedContent: '[wxc-exec] policy violation: write blocked' },
      });
      expect(r).not.toBeNull();
    });

    it('detects NTSTATUS 0xC0000022', () => {
      const r = detectShellSandboxDenial({
        toolName: 'bash',
        toolArgs: { command: 'foo' },
        toolResult: 'failed: NTSTATUS 0xC0000022',
      });
      expect(r).not.toBeNull();
    });

    it('returns null when toolResult is empty', () => {
      expect(detectShellSandboxDenial({ toolName: 'bash', toolArgs: { command: 'x' }, toolResult: '' })).toBeNull();
      expect(detectShellSandboxDenial({ toolName: 'bash', toolArgs: { command: 'x' }, toolResult: null })).toBeNull();
    });
  });
});
