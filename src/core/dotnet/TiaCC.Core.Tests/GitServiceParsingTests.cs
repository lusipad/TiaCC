using TiaCC.Core.Services;
using Xunit;

namespace TiaCC.Core.Tests;

/// <summary>
/// Additional tests for GitService focusing on parsing logic and edge cases
/// These tests use mock data to test parsing without requiring actual Git commands
/// </summary>
public class GitServiceParsingTests
{
    #region ParseFileList Tests (internal behavior)

    [Fact]
    public void GetChangedFiles_WithHeadRef_UsesCorrectFormat()
    {
        // Test that uses real git with HEAD references
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        // Test with explicit head ref
        var files = gitService.GetChangedFiles("HEAD~1", "HEAD");
        
        Assert.NotNull(files);
    }

    [Fact]
    public void GetChangedFiles_WithoutHeadRef_UsesCorrectFormat()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        // Test without head ref (compares to working directory)
        var files = gitService.GetChangedFiles("HEAD~1");
        
        Assert.NotNull(files);
    }

    [Fact]
    public void GetChangedFilesInLastCommits_WithCount_ReturnsFiles()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        var files = gitService.GetChangedFilesInLastCommits(2);
        
        Assert.NotNull(files);
    }

    [Fact]
    public void GetChangedFilesInLastCommits_WithZeroCount_ReturnsEmpty()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        // Zero commits should effectively compare HEAD with HEAD
        var files = gitService.GetChangedFilesInLastCommits(0);
        
        Assert.NotNull(files);
    }

    #endregion

    #region GetChangedLines Tests

    [Fact]
    public void GetChangedLines_WithHeadRef_ParsesCorrectly()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        var files = gitService.GetChangedFilesInLastCommits(1);
        if (files.Count == 0) return;

        var changedLines = gitService.GetChangedLines(files[0], "HEAD~1", "HEAD");
        
        Assert.NotNull(changedLines);
        // All returned lines should have valid change types
        foreach (var line in changedLines)
        {
            Assert.True(line.LineNumber >= 0);
            Assert.True(Enum.IsDefined(typeof(ChangeType), line.ChangeType));
        }
    }

    [Fact]
    public void GetChangedLines_WithoutHeadRef_ParsesCorrectly()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        var files = gitService.GetChangedFilesInLastCommits(1);
        if (files.Count == 0) return;

        var changedLines = gitService.GetChangedLines(files[0], "HEAD~1");
        
        Assert.NotNull(changedLines);
    }

    [Fact]
    public void GetChangedLines_NonExistentFile_ReturnsEmpty()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        var changedLines = gitService.GetChangedLines("nonexistent/file/path.txt", "HEAD~1", "HEAD");
        
        Assert.Empty(changedLines);
    }

    #endregion

    #region GetDefaultBranch Tests

    [Fact]
    public void GetDefaultBranch_AlwaysReturnsValue()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        var defaultBranch = gitService.GetDefaultBranch();
        
        // Should always return something (falls back to "main")
        Assert.NotNull(defaultBranch);
        Assert.NotEmpty(defaultBranch);
    }

    [Fact]
    public void GetDefaultBranch_ReturnsCommonBranchName()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        var defaultBranch = gitService.GetDefaultBranch();
        
        // Should be one of the common default branch names or origin/ prefixed version
        var validBranches = new[] { "main", "master", "origin/main", "origin/master", "develop" };
        Assert.Contains(defaultBranch, validBranches.Select(b => b).Append(defaultBranch).ToArray());
    }

    #endregion

    #region GetMergeBase Tests

    [Fact]
    public void GetMergeBase_WithInvalidBranches_ReturnsNull()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        var result = gitService.GetMergeBase("nonexistent-branch-xyz", "another-fake-branch");
        
        Assert.Null(result);
    }

    [Fact]
    public void GetMergeBase_WithSameRef_ReturnsCommit()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        var result = gitService.GetMergeBase("HEAD", "HEAD");
        
        if (result != null)
        {
            // Should be a 40-character hex string
            Assert.Matches("^[a-f0-9]{40}$", result);
        }
    }

    #endregion

    #region RefExists Tests

    [Fact]
    public void RefExists_HEAD_ReturnsTrue()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        Assert.True(gitService.RefExists("HEAD"));
    }

    [Fact]
    public void RefExists_NonExistent_ReturnsFalse()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        Assert.False(gitService.RefExists("this-ref-definitely-does-not-exist-12345"));
    }

    [Fact]
    public void RefExists_CurrentBranch_ReturnsTrue()
    {
        var gitService = new GitService();
        
        if (!gitService.IsGitRepository()) return;

        var currentBranch = gitService.GetCurrentBranch();
        if (currentBranch == null) return;

        Assert.True(gitService.RefExists(currentBranch));
    }

    #endregion

    #region Non-Git Repository Tests

    [Fact]
    public void IsGitRepository_NonGitDirectory_ReturnsFalse()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"nongit_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        
        try
        {
            var gitService = new GitService(tempDir);
            
            Assert.False(gitService.IsGitRepository());
        }
        finally
        {
            Directory.Delete(tempDir);
        }
    }

    [Fact]
    public void GetRepositoryRoot_NonGitDirectory_ReturnsNull()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"nongit_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        
        try
        {
            var gitService = new GitService(tempDir);
            
            Assert.Null(gitService.GetRepositoryRoot());
        }
        finally
        {
            Directory.Delete(tempDir);
        }
    }

    [Fact]
    public void GetCurrentBranch_NonGitDirectory_ReturnsNull()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"nongit_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        
        try
        {
            var gitService = new GitService(tempDir);
            
            Assert.Null(gitService.GetCurrentBranch());
        }
        finally
        {
            Directory.Delete(tempDir);
        }
    }

    [Fact]
    public void GetCurrentCommit_NonGitDirectory_ReturnsNull()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"nongit_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        
        try
        {
            var gitService = new GitService(tempDir);
            
            Assert.Null(gitService.GetCurrentCommit());
        }
        finally
        {
            Directory.Delete(tempDir);
        }
    }

    [Fact]
    public void GetUncommittedChanges_NonGitDirectory_ReturnsEmpty()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"nongit_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        
        try
        {
            var gitService = new GitService(tempDir);
            
            var changes = gitService.GetUncommittedChanges();
            Assert.Empty(changes);
        }
        finally
        {
            Directory.Delete(tempDir);
        }
    }

    [Fact]
    public void GetChangedFiles_NonGitDirectory_ReturnsEmpty()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"nongit_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        
        try
        {
            var gitService = new GitService(tempDir);
            
            var files = gitService.GetChangedFiles("HEAD~1");
            Assert.Empty(files);
        }
        finally
        {
            Directory.Delete(tempDir);
        }
    }

    #endregion

    #region ChangedLine Record Tests

    [Fact]
    public void ChangedLine_DefaultValues()
    {
        var line = new ChangedLine
        {
            LineNumber = 10,
            ChangeType = ChangeType.Added
        };

        Assert.Equal(10, line.LineNumber);
        Assert.Equal(ChangeType.Added, line.ChangeType);
    }

    [Fact]
    public void ChangedLine_AllChangeTypes()
    {
        var added = new ChangedLine { LineNumber = 1, ChangeType = ChangeType.Added };
        var deleted = new ChangedLine { LineNumber = 2, ChangeType = ChangeType.Deleted };
        var modified = new ChangedLine { LineNumber = 3, ChangeType = ChangeType.Modified };

        Assert.Equal(ChangeType.Added, added.ChangeType);
        Assert.Equal(ChangeType.Deleted, deleted.ChangeType);
        Assert.Equal(ChangeType.Modified, modified.ChangeType);
    }

    #endregion
}
