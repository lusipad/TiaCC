using System.Diagnostics;
using TiaCC.Core.Services;
using Xunit;

namespace TiaCC.Core.Tests;

/// <summary>
/// Tests for GitService
/// </summary>
public class GitServiceTests
{
    private sealed class TempGitRepo : IDisposable
    {
        public string Root { get; } = Path.Combine(Path.GetTempPath(), $"tiacc_git_{Guid.NewGuid():N}");

        public TempGitRepo()
        {
            Directory.CreateDirectory(Root);

            RunGit("init", "-b", "main");
            RunGit("config", "user.email", "tiacc-tests@example.com");
            RunGit("config", "user.name", "TiaCC Tests");
        }

        public void WriteFile(string relativePath, string contents)
        {
            var fullPath = Path.Combine(Root, relativePath.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
            File.WriteAllText(fullPath, contents);
        }

        public void AddAll() => RunGit("add", "-A");

        public string Commit(string message)
        {
            AddAll();
            RunGit("commit", "-m", message);
            return RunGit("rev-parse", "HEAD").Trim();
        }

        public void CheckoutNewBranch(string branch, string startPoint) => RunGit("checkout", "-b", branch, startPoint);
        public void Checkout(string branch) => RunGit("checkout", branch);

        public string RunGit(params string[] args) => RunGitProcess(Root, args);

        public void Dispose()
        {
            try
            {
                Directory.Delete(Root, recursive: true);
            }
            catch
            {
                // Best-effort cleanup for CI/Windows file locking flakiness.
            }
        }
    }

    private static string RunGitProcess(string workingDirectory, params string[] args)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = "git",
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        foreach (var arg in args)
        {
            startInfo.ArgumentList.Add(arg);
        }

        using var process = Process.Start(startInfo);
        if (process == null)
        {
            throw new InvalidOperationException("Failed to start git process.");
        }

        var output = process.StandardOutput.ReadToEnd();
        var error = process.StandardError.ReadToEnd();
        process.WaitForExit();

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"git {string.Join(" ", args)} failed: {error}");
        }

        return output;
    }

    [Fact]
    public void RepositoryBasics_WorkInFreshRepo()
    {
        using var repo = new TempGitRepo();
        var service = new GitService(repo.Root);

        Assert.True(service.IsGitRepository());

        var root = service.GetRepositoryRoot();
        Assert.NotNull(root);
        Assert.Equal(Path.GetFullPath(repo.Root), Path.GetFullPath(root));

        Assert.Null(service.GetCurrentBranch()); // empty repo: no HEAD commit yet
        Assert.Null(service.GetCurrentCommit()); // no commits yet

        repo.WriteFile("src/a.txt", "one\n");
        var firstCommit = repo.Commit("initial");

        Assert.Equal("main", service.GetCurrentBranch());

        repo.WriteFile("src/a.txt", "two\n");
        var secondCommit = repo.Commit("second");

        var currentCommit = service.GetCurrentCommit();
        Assert.NotNull(currentCommit);
        Assert.Matches("^[a-f0-9]{40}$", currentCommit);
        Assert.Equal(secondCommit, currentCommit);
        Assert.NotEqual(firstCommit, currentCommit);
    }

    [Fact]
    public void GetUncommittedChanges_IncludesUnstagedStagedAndUntracked()
    {
        using var repo = new TempGitRepo();
        repo.WriteFile("src/a.txt", "one\n");
        repo.Commit("initial");

        // Unstaged modification
        repo.WriteFile("src/a.txt", "two\n");

        // Staged new file
        repo.WriteFile("src/b.txt", "staged\n");
        repo.RunGit("add", "src/b.txt");

        // Untracked file
        repo.WriteFile("src/c.txt", "untracked\n");

        var service = new GitService(repo.Root);
        var changes = service.GetUncommittedChanges();

        Assert.Contains("src/a.txt", changes);
        Assert.Contains("src/b.txt", changes);
        Assert.Contains("src/c.txt", changes);
    }

    [Fact]
    public void GetChangedFiles_And_GetChangedLines_WorkBetweenCommits()
    {
        using var repo = new TempGitRepo();
        repo.WriteFile("src/a.txt", "line1\nline2\n");
        var baseCommit = repo.Commit("base");

        repo.WriteFile("src/a.txt", "line1-mod\nline2\nline3\n");
        var headCommit = repo.Commit("change");

        var service = new GitService(repo.Root);

        var changedFiles = service.GetChangedFiles(baseCommit, headCommit);
        Assert.Contains("src/a.txt", changedFiles);

        var lastCommitFiles = service.GetChangedFilesInLastCommits(1);
        Assert.Contains("src/a.txt", lastCommitFiles);

        var changedLines = service.GetChangedLines("src/a.txt", baseCommit, headCommit);
        Assert.NotEmpty(changedLines);
        Assert.Contains(changedLines, l => l.ChangeType == ChangeType.Added);
        Assert.Contains(changedLines, l => l.ChangeType == ChangeType.Deleted);
    }

    [Fact]
    public void MergeBase_And_RefExists_WorkAcrossBranches()
    {
        using var repo = new TempGitRepo();
        repo.WriteFile("src/a.txt", "base\n");
        var baseCommit = repo.Commit("base");

        repo.WriteFile("src/a.txt", "main\n");
        repo.Commit("main change");

        repo.CheckoutNewBranch("feature", baseCommit);
        repo.WriteFile("src/a.txt", "feature\n");
        repo.Commit("feature change");
        repo.Checkout("main");

        var service = new GitService(repo.Root);

        Assert.True(service.RefExists("main"));
        Assert.True(service.RefExists("feature"));
        Assert.False(service.RefExists("nonexistent-ref-12345"));

        Assert.Equal("main", service.GetDefaultBranch());

        var mergeBase = service.GetMergeBase("main", "feature");
        Assert.Equal(baseCommit, mergeBase);
    }

    [Fact]
    public void NonGitDirectory_ReturnsSafeDefaults()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"nongit_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);

        try
        {
            var service = new GitService(tempDir);
            Assert.False(service.IsGitRepository());
            Assert.Null(service.GetRepositoryRoot());
            Assert.Null(service.GetCurrentBranch());
            Assert.Null(service.GetCurrentCommit());
            Assert.Empty(service.GetUncommittedChanges());
            Assert.Empty(service.GetChangedFiles("HEAD"));
            Assert.Empty(service.GetChangedLines("src/a.txt", "HEAD"));
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }
}
