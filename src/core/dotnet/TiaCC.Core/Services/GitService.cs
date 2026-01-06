using System.Diagnostics;
using System.Text.RegularExpressions;

namespace TiaCC.Core.Services;

/// <summary>
/// Git utilities for detecting changed files
/// </summary>
public class GitService
{
    private readonly string _workingDirectory;

    public GitService(string? workingDirectory = null)
    {
        _workingDirectory = workingDirectory ?? Directory.GetCurrentDirectory();
    }

    /// <summary>
    /// Check if the working directory is a Git repository
    /// </summary>
    public bool IsGitRepository()
    {
        try
        {
            var result = RunGit("rev-parse --is-inside-work-tree");
            return result.Trim().Equals("true", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Get the repository root directory
    /// </summary>
    public string? GetRepositoryRoot()
    {
        try
        {
            return RunGit("rev-parse --show-toplevel").Trim();
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Get current branch name
    /// </summary>
    public string? GetCurrentBranch()
    {
        try
        {
            return RunGit("rev-parse --abbrev-ref HEAD").Trim();
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Get current commit hash
    /// </summary>
    public string? GetCurrentCommit()
    {
        try
        {
            return RunGit("rev-parse HEAD").Trim();
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Get files changed in working directory (unstaged + staged)
    /// </summary>
    public List<string> GetUncommittedChanges()
    {
        var files = new HashSet<string>();

        try
        {
            // Unstaged changes
            var unstaged = RunGit("diff --name-only");
            foreach (var file in ParseFileList(unstaged))
            {
                files.Add(file);
            }

            // Staged changes
            var staged = RunGit("diff --cached --name-only");
            foreach (var file in ParseFileList(staged))
            {
                files.Add(file);
            }

            // Untracked files
            var untracked = RunGit("ls-files --others --exclude-standard");
            foreach (var file in ParseFileList(untracked))
            {
                files.Add(file);
            }
        }
        catch
        {
            // Return empty list if git fails
        }

        return files.ToList();
    }

    /// <summary>
    /// Get files changed between two commits/branches
    /// </summary>
    public List<string> GetChangedFiles(string baseRef, string? headRef = null)
    {
        try
        {
            var command = headRef != null
                ? $"diff --name-only {baseRef}...{headRef}"
                : $"diff --name-only {baseRef}";

            var output = RunGit(command);
            return ParseFileList(output);
        }
        catch
        {
            return [];
        }
    }

    /// <summary>
    /// Get files changed in the last N commits
    /// </summary>
    public List<string> GetChangedFilesInLastCommits(int count = 1)
    {
        try
        {
            var output = RunGit($"diff --name-only HEAD~{count}");
            return ParseFileList(output);
        }
        catch
        {
            return [];
        }
    }

    /// <summary>
    /// Get changed lines for a specific file between two refs
    /// </summary>
    public List<ChangedLine> GetChangedLines(string filePath, string baseRef, string? headRef = null)
    {
        var changedLines = new List<ChangedLine>();

        try
        {
            var command = headRef != null
                ? $"diff -U0 {baseRef}...{headRef} -- \"{filePath}\""
                : $"diff -U0 {baseRef} -- \"{filePath}\"";

            var output = RunGit(command);
            changedLines.AddRange(ParseDiffOutput(output));
        }
        catch
        {
            // Return empty list if git fails
        }

        return changedLines;
    }

    /// <summary>
    /// Get the merge base between two branches
    /// </summary>
    public string? GetMergeBase(string branch1, string branch2)
    {
        try
        {
            return RunGit($"merge-base {branch1} {branch2}").Trim();
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Check if a ref exists
    /// </summary>
    public bool RefExists(string refName)
    {
        try
        {
            RunGit($"rev-parse --verify {refName}");
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Get default branch name (main or master)
    /// </summary>
    public string GetDefaultBranch()
    {
        // Try common default branch names
        if (RefExists("origin/main")) return "origin/main";
        if (RefExists("origin/master")) return "origin/master";
        if (RefExists("main")) return "main";
        if (RefExists("master")) return "master";

        // Try to get from remote
        try
        {
            var output = RunGit("remote show origin");
            var match = Regex.Match(output, @"HEAD branch:\s*(\S+)");
            if (match.Success)
            {
                return $"origin/{match.Groups[1].Value}";
            }
        }
        catch
        {
            // Ignore
        }

        return "main"; // Default fallback
    }

    private string RunGit(string arguments)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "git",
                Arguments = arguments,
                WorkingDirectory = _workingDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        process.Start();

        // Read stdout and stderr asynchronously to prevent deadlock
        // when either buffer fills up
        var outputTask = process.StandardOutput.ReadToEndAsync();
        var errorTask = process.StandardError.ReadToEndAsync();

        process.WaitForExit();

        var output = outputTask.GetAwaiter().GetResult();
        var error = errorTask.GetAwaiter().GetResult();

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"git {arguments} failed: {error}");
        }

        return output;
    }

    private static List<string> ParseFileList(string output)
    {
        return output
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(f => f.Trim())
            .Where(f => !string.IsNullOrEmpty(f))
            .Select(f => f.Replace('\\', '/'))
            .ToList();
    }

    private static List<ChangedLine> ParseDiffOutput(string diffOutput)
    {
        var result = new List<ChangedLine>();
        var hunkHeaderRegex = new Regex(@"^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@");

        foreach (var line in diffOutput.Split('\n'))
        {
            var match = hunkHeaderRegex.Match(line);
            if (match.Success)
            {
                var oldStart = int.Parse(match.Groups[1].Value);
                var oldCount = match.Groups[2].Success ? int.Parse(match.Groups[2].Value) : 1;
                var newStart = int.Parse(match.Groups[3].Value);
                var newCount = match.Groups[4].Success ? int.Parse(match.Groups[4].Value) : 1;

                // Add deleted lines
                for (var i = 0; i < oldCount; i++)
                {
                    result.Add(new ChangedLine
                    {
                        LineNumber = oldStart + i,
                        ChangeType = ChangeType.Deleted
                    });
                }

                // Add added lines
                for (var i = 0; i < newCount; i++)
                {
                    result.Add(new ChangedLine
                    {
                        LineNumber = newStart + i,
                        ChangeType = ChangeType.Added
                    });
                }
            }
        }

        return result;
    }
}

public record ChangedLine
{
    public int LineNumber { get; init; }
    public ChangeType ChangeType { get; init; }
}

public enum ChangeType
{
    Added,
    Deleted,
    Modified
}
