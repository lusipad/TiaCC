/**
 * Git utilities for detecting changed files.
 */

import simpleGit, { SimpleGit } from 'simple-git';
import { existsSync } from 'fs';

export class GitUtils {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath?: string) {
    this.repoPath = repoPath ?? process.cwd();
    this.git = simpleGit(this.repoPath);
  }

  /**
   * Check if the path is inside a Git repository
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await this.git.revparse(['--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get list of changed files between current state and a base reference
   */
  async getChangedFiles(options: {
    baseRef?: string;
    includeUntracked?: boolean;
    extensions?: string[];
  } = {}): Promise<string[]> {
    const {
      baseRef = 'HEAD~1',
      includeUntracked = false,
      extensions,
    } = options;

    const changed = new Set<string>();

    try {
      // Get diff against base ref
      const diffSummary = await this.git.diffSummary([baseRef]);
      for (const file of diffSummary.files) {
        changed.add(file.file);
      }

      // Get staged changes
      const stagedSummary = await this.git.diffSummary(['--cached']);
      for (const file of stagedSummary.files) {
        changed.add(file.file);
      }

      // Include untracked files if requested
      if (includeUntracked) {
        const status = await this.git.status();
        for (const file of status.not_added) {
          changed.add(file);
        }
      }
    } catch (error) {
      console.error(`Error getting git changes: ${error}`);
    }

    // Filter by extensions if specified
    let result = Array.from(changed);
    if (extensions && extensions.length > 0) {
      const extSet = new Set(extensions.map(e => e.toLowerCase()));
      result = result.filter(f => {
        const ext = '.' + f.split('.').pop()?.toLowerCase();
        return extSet.has(ext);
      });
    }

    return result.sort();
  }

  /**
   * Get the current commit hash
   */
  async getCurrentCommitHash(short = false): Promise<string | null> {
    try {
      const hash = await this.git.revparse([short ? '--short' : 'HEAD']);
      return hash.trim();
    } catch {
      return null;
    }
  }

  /**
   * Get the current branch name
   */
  async getBranchName(): Promise<string | null> {
    try {
      const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
      return branch.trim();
    } catch {
      return null;
    }
  }

  /**
   * Get the merge base between two branches
   */
  async getMergeBase(branch1: string, branch2 = 'HEAD'): Promise<string | null> {
    try {
      const base = await this.git.raw(['merge-base', branch1, branch2]);
      return base.trim();
    } catch {
      return null;
    }
  }

  /**
   * Get all files changed since a specific commit
   */
  async getFilesChangedSince(sinceCommit: string): Promise<string[]> {
    return this.getChangedFiles({ baseRef: sinceCommit });
  }

  /**
   * Get changed lines for each file (for function-level impact analysis)
   * Returns a map of file path -> array of changed line numbers
   */
  async getChangedLines(options: {
    baseRef?: string;
    extensions?: string[];
  } = {}): Promise<Map<string, number[]>> {
    const { baseRef = 'HEAD~1', extensions } = options;
    const result = new Map<string, number[]>();

    try {
      // Get unified diff with context
      const diffOutput = await this.git.diff([baseRef, '-U0']);

      let currentFile: string | null = null;
      const lines = diffOutput.split('\n');

      for (const line of lines) {
        // Match file header: diff --git a/path b/path
        const fileMatch = line.match(/^diff --git a\/(.*) b\/(.*)/);
        if (fileMatch) {
          currentFile = fileMatch[2];

          // Filter by extension if specified
          if (extensions && extensions.length > 0) {
            const ext = '.' + currentFile.split('.').pop()?.toLowerCase();
            if (!extensions.some(e => e.toLowerCase() === ext)) {
              currentFile = null;
            }
          }

          if (currentFile && !result.has(currentFile)) {
            result.set(currentFile, []);
          }
          continue;
        }

        // Match hunk header: @@ -old,count +new,count @@
        if (currentFile && line.startsWith('@@')) {
          const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
          if (hunkMatch) {
            const startLine = parseInt(hunkMatch[1], 10);
            const lineCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;

            const changedLines = result.get(currentFile) || [];
            for (let i = 0; i < lineCount; i++) {
              changedLines.push(startLine + i);
            }
            result.set(currentFile, changedLines);
          }
        }
      }
    } catch (error) {
      console.error(`Error getting changed lines: ${error}`);
    }

    return result;
  }

  /**
   * Analyze change scale for determining recommendation strategy
   */
  async analyzeChangeScale(baseRef: string = 'HEAD~1'): Promise<{
    totalFiles: number;
    totalLines: number;
    scale: 'small' | 'medium' | 'large';
  }> {
    const changedLines = await this.getChangedLines({ baseRef });

    let totalLines = 0;
    for (const lines of changedLines.values()) {
      totalLines += lines.length;
    }

    const totalFiles = changedLines.size;

    // Determine scale based on thresholds from plan
    let scale: 'small' | 'medium' | 'large';
    if (totalLines < 100) {
      scale = 'small';
    } else if (totalLines < 500 && totalFiles < 30) {
      scale = 'medium';
    } else {
      scale = 'large';
    }

    return { totalFiles, totalLines, scale };
  }
}
