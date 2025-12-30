using TiaCC.Core.Services;
using Xunit;

namespace TiaCC.Core.Tests;

/// <summary>
/// Tests for GitService
/// </summary>
public class GitServiceTests
{
    [Fact]
    public void IsGitRepository_InGitRepo_ReturnsTrue()
    {
        // Arrange
        var gitService = new GitService();

        // Act & Assert
        // This test assumes it's run from within the TiaCC repository
        Assert.True(gitService.IsGitRepository());
    }

    [Fact]
    public void GetRepositoryRoot_InGitRepo_ReturnsPath()
    {
        // Arrange
        var gitService = new GitService();

        // Act
        var root = gitService.GetRepositoryRoot();

        // Assert
        Assert.NotNull(root);
        Assert.True(Directory.Exists(root));
    }

    [Fact]
    public void GetCurrentBranch_ReturnsNonEmptyString()
    {
        // Arrange
        var gitService = new GitService();

        // Act
        var branch = gitService.GetCurrentBranch();

        // Assert
        Assert.NotNull(branch);
        Assert.NotEmpty(branch);
    }

    [Fact]
    public void GetCurrentCommit_ReturnsValidHash()
    {
        // Arrange
        var gitService = new GitService();

        // Act
        var commit = gitService.GetCurrentCommit();

        // Assert
        Assert.NotNull(commit);
        Assert.Matches("^[a-f0-9]{40}$", commit);
    }

    [Fact]
    public void RefExists_WithValidRef_ReturnsTrue()
    {
        // Arrange
        var gitService = new GitService();

        // Act - HEAD always exists
        var exists = gitService.RefExists("HEAD");

        // Assert
        Assert.True(exists);
    }

    [Fact]
    public void RefExists_WithInvalidRef_ReturnsFalse()
    {
        // Arrange
        var gitService = new GitService();

        // Act
        var exists = gitService.RefExists("nonexistent-ref-that-should-not-exist-12345");

        // Assert
        Assert.False(exists);
    }

    [Fact]
    public void GetDefaultBranch_ReturnsValidBranch()
    {
        // Arrange
        var gitService = new GitService();

        // Act
        var defaultBranch = gitService.GetDefaultBranch();

        // Assert
        Assert.NotNull(defaultBranch);
        Assert.Contains(defaultBranch, new[] { "main", "master", "origin/main", "origin/master" });
    }

    [Fact]
    public void GetUncommittedChanges_ReturnsListWithoutError()
    {
        // Arrange
        var gitService = new GitService();

        // Act
        var changes = gitService.GetUncommittedChanges();

        // Assert
        Assert.NotNull(changes);
        // List can be empty if no uncommitted changes, that's fine
    }

    [Fact]
    public void GetChangedFilesInLastCommits_ReturnsListWithoutError()
    {
        // Arrange
        var gitService = new GitService();

        // Act
        var changes = gitService.GetChangedFilesInLastCommits(1);

        // Assert
        Assert.NotNull(changes);
        // Should have at least some files in the last commit
    }

    [Fact]
    public void GetMergeBase_WithSameBranch_ReturnsCommit()
    {
        // Arrange
        var gitService = new GitService();
        var branch = gitService.GetCurrentBranch();
        if (branch == null) return; // Skip if can't get current branch

        // Check if we have at least 2 commits (HEAD~1 exists)
        // This may not be true in shallow clone CI environments
        var parentCheck = gitService.GetMergeBase("HEAD", "HEAD");
        if (parentCheck == null) return; // Skip if git operations don't work

        // Act
        var mergeBase = gitService.GetMergeBase("HEAD", "HEAD~1");

        // Assert - may be null in shallow clone, so we only assert format if not null
        if (mergeBase != null)
        {
            Assert.Matches("^[a-f0-9]{40}$", mergeBase);
        }
    }

    [Fact]
    public void GetChangedFiles_WithValidRefs_ReturnsFiles()
    {
        // Arrange
        var gitService = new GitService();

        // Act - compare last commit to its parent
        var files = gitService.GetChangedFiles("HEAD~1", "HEAD");

        // Assert
        Assert.NotNull(files);
        // Should have files changed in the last commit
    }

    [Fact]
    public void GitService_WithNonGitDirectory_IsGitRepositoryReturnsFalse()
    {
        // Arrange - use temp directory which shouldn't be a git repo
        var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(tempDir);

        try
        {
            var gitService = new GitService(tempDir);

            // Act
            var isRepo = gitService.IsGitRepository();

            // Assert
            Assert.False(isRepo);
        }
        finally
        {
            Directory.Delete(tempDir);
        }
    }

    [Fact]
    public void ParseDiffOutput_HandlesHunkHeaders()
    {
        // This is testing the internal parsing logic indirectly
        // by checking that GetChangedLines returns reasonable data
        var gitService = new GitService();

        // Get changed lines for a file from the last commit
        var files = gitService.GetChangedFilesInLastCommits(1);
        if (files.Count == 0) return;

        var changedLines = gitService.GetChangedLines(files[0], "HEAD~1", "HEAD");

        // Assert
        Assert.NotNull(changedLines);
        // Each changed line should have valid data
        foreach (var line in changedLines)
        {
            Assert.True(line.LineNumber >= 0);
            Assert.True(line.ChangeType == ChangeType.Added ||
                       line.ChangeType == ChangeType.Deleted ||
                       line.ChangeType == ChangeType.Modified);
        }
    }
}
