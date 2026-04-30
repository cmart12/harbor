import { describe, it, expect } from 'vitest';
import { parseGitRemote } from './cloud-agent';

describe('cloud-agent', () => {
  describe('parseGitRemote', () => {
    it('parses HTTPS remote URL', () => {
      const result = parseGitRemote('https://github.com/octocat/hello-world.git');
      expect(result).toEqual({ owner: 'octocat', repo: 'hello-world' });
    });

    it('parses HTTPS remote URL without .git suffix', () => {
      const result = parseGitRemote('https://github.com/octocat/hello-world');
      expect(result).toEqual({ owner: 'octocat', repo: 'hello-world' });
    });

    it('parses SSH remote URL', () => {
      const result = parseGitRemote('git@github.com:octocat/hello-world.git');
      expect(result).toEqual({ owner: 'octocat', repo: 'hello-world' });
    });

    it('parses SSH remote URL without .git suffix', () => {
      const result = parseGitRemote('git@github.com:octocat/hello-world');
      expect(result).toEqual({ owner: 'octocat', repo: 'hello-world' });
    });

    it('handles org repos', () => {
      const result = parseGitRemote('https://github.com/my-org/my-repo.git');
      expect(result).toEqual({ owner: 'my-org', repo: 'my-repo' });
    });

    it('handles repos with underscores and dots in name', () => {
      const result = parseGitRemote('https://github.com/user/my_repo.v2.git');
      expect(result).toEqual({ owner: 'user', repo: 'my_repo' });
    });

    it('returns null for non-GitHub URLs', () => {
      const result = parseGitRemote('https://gitlab.com/user/repo.git');
      expect(result).toBeNull();
    });

    it('returns null for invalid URLs', () => {
      expect(parseGitRemote('')).toBeNull();
      expect(parseGitRemote('not-a-url')).toBeNull();
    });

    it('handles URLs with trailing whitespace/newline', () => {
      const result = parseGitRemote('https://github.com/patniko/space.git\n');
      expect(result).toEqual({ owner: 'patniko', repo: 'space' });
    });

    it('handles HTTPS URL with embedded credentials', () => {
      const result = parseGitRemote('https://user:token@github.com/owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });
  });
});
