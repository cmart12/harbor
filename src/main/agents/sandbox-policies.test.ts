import { describe, it, expect } from 'vitest';
import { isReadOnlyCommand, createSandboxPreToolHook, SANDBOX_SYSTEM_PROMPT, IS_WINDOWS } from './sandbox-policies';

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
});
