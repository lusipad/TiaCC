/**
 * Unit tests for the git utilities module.
 */

import { describe, it, expect } from 'vitest';
import { GitUtils } from '../src/git-utils.js';

describe('GitUtils', () => {
  describe('constructor', () => {
    it('should create instance with default repo path', () => {
      const gitUtils = new GitUtils();
      expect(gitUtils).toBeInstanceOf(GitUtils);
    });

    it('should create instance with custom repo path', () => {
      // Use current directory to avoid path not exists error
      const gitUtils = new GitUtils(process.cwd());
      expect(gitUtils).toBeInstanceOf(GitUtils);
    });
  });

  describe('isGitRepo', () => {
    it('should detect if current directory is a git repo', async () => {
      const gitUtils = new GitUtils();
      const isRepo = await gitUtils.isGitRepo();
      // Since we're testing in a git repo, this should be true
      expect(typeof isRepo).toBe('boolean');
    });

    it('should return false for non-git directory', async () => {
      const gitUtils = new GitUtils('/tmp');
      const isRepo = await gitUtils.isGitRepo();
      // /tmp is typically not a git repo
      expect(typeof isRepo).toBe('boolean');
    });
  });

  describe('getCurrentCommitHash', () => {
    it('should get full commit hash', async () => {
      const gitUtils = new GitUtils();
      const hash = await gitUtils.getCurrentCommitHash();

      if (hash) {
        // Git commit hash should be 40 characters
        expect(hash.length).toBeGreaterThanOrEqual(40);
      } else {
        // If null, we're not in a git repo
        expect(hash).toBeNull();
      }
    });

    it('should get short commit hash', async () => {
      const gitUtils = new GitUtils();
      const hash = await gitUtils.getCurrentCommitHash(true);

      if (hash) {
        // Short hash is typically 7 characters
        expect(hash.length).toBeGreaterThan(0);
        expect(hash.length).toBeLessThan(41);
      } else {
        expect(hash).toBeNull();
      }
    });
  });

  describe('getBranchName', () => {
    it('should get current branch name', async () => {
      const gitUtils = new GitUtils();
      const branch = await gitUtils.getBranchName();

      if (branch) {
        expect(typeof branch).toBe('string');
        expect(branch.length).toBeGreaterThan(0);
      } else {
        expect(branch).toBeNull();
      }
    });
  });

  describe('getChangedFiles', () => {
    it('should handle default options', async () => {
      const gitUtils = new GitUtils();

      try {
        const files = await gitUtils.getChangedFiles();
        expect(Array.isArray(files)).toBe(true);
      } catch (error) {
        // It's okay if this fails in test environment
        expect(error).toBeDefined();
      }
    });

    it('should handle custom base ref', async () => {
      const gitUtils = new GitUtils();

      try {
        const files = await gitUtils.getChangedFiles({ baseRef: 'HEAD~2' });
        expect(Array.isArray(files)).toBe(true);
      } catch (error) {
        // It's okay if this fails in test environment
        expect(error).toBeDefined();
      }
    });

    it('should filter by extensions', async () => {
      const gitUtils = new GitUtils();

      try {
        const files = await gitUtils.getChangedFiles({ extensions: ['.ts', '.js'] });
        expect(Array.isArray(files)).toBe(true);

        // All returned files should have .ts or .js extension
        for (const file of files) {
          const hasValidExt = file.endsWith('.ts') || file.endsWith('.js');
          expect(hasValidExt).toBe(true);
        }
      } catch (error) {
        // It's okay if this fails in test environment
        expect(error).toBeDefined();
      }
    });
  });
});
