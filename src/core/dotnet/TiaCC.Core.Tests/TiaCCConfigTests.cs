using System.Text.Json;
using TiaCC.Core.Models;
using Xunit;

namespace TiaCC.Core.Tests;

public class TiaCCConfigTests : IDisposable
{
    private readonly string _testDir;

    public TiaCCConfigTests()
    {
        _testDir = Path.Combine(Path.GetTempPath(), $"tiacc_config_test_{Guid.NewGuid():N}");
        Directory.CreateDirectory(_testDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_testDir))
            Directory.Delete(_testDir, true);
        GC.SuppressFinalize(this);
    }

    #region Default Values Tests

    [Fact]
    public void NewConfig_HasDefaultDatabasePath()
    {
        var config = new TiaCCConfig();
        Assert.Equal("impact_map.db", config.Database);
    }

    [Fact]
    public void NewConfig_HasDefaultSourcePatterns()
    {
        var config = new TiaCCConfig();
        Assert.Contains("*.cs", config.SourcePatterns);
        Assert.Contains("*.cpp", config.SourcePatterns);
        Assert.Contains("*.py", config.SourcePatterns);
    }

    [Fact]
    public void NewConfig_HasDefaultExcludeDirs()
    {
        var config = new TiaCCConfig();
        Assert.Contains("node_modules", config.ExcludeDirs);
        Assert.Contains("bin", config.ExcludeDirs);
        Assert.Contains(".git", config.ExcludeDirs);
    }

    [Fact]
    public void NewTestRunnerConfig_HasDefaultCommand()
    {
        var config = new TestRunnerConfig();
        Assert.Equal("dotnet test", config.Command);
    }

    [Fact]
    public void NewCoverageConfig_HasDefaultFormat()
    {
        var config = new CoverageConfig();
        Assert.Equal("auto", config.Format);
        Assert.Equal("coverage", config.Path);
    }

    [Fact]
    public void NewGitConfig_HasDefaultBaseBranch()
    {
        var config = new GitConfig();
        Assert.Equal("main", config.BaseBranch);
        Assert.True(config.IncludeUncommitted);
    }

    [Fact]
    public void NewDashboardConfig_HasDefaultOutputDir()
    {
        var config = new DashboardConfig();
        Assert.Equal("./artifacts/tiacc-data/dashboard", config.OutputDir);
        Assert.Equal("json", config.Format);
    }

    #endregion

    #region Load Tests

    [Fact]
    public void Load_NonExistentFile_ReturnsDefaultConfig()
    {
        var config = TiaCCConfig.Load(Path.Combine(_testDir, "nonexistent.json"));
        Assert.NotNull(config);
        Assert.Equal("impact_map.db", config.Database);
    }

    [Fact]
    public void Load_ValidFile_LoadsCorrectly()
    {
        var configPath = Path.Combine(_testDir, "config.json");
        var json = """
        {
            "database": "custom.db",
            "sourcePatterns": ["*.cs"],
            "excludeDirs": ["bin"]
        }
        """;
        File.WriteAllText(configPath, json);

        var config = TiaCCConfig.Load(configPath);

        Assert.Equal("custom.db", config.Database);
        Assert.Single(config.SourcePatterns);
        Assert.Equal("*.cs", config.SourcePatterns[0]);
    }

    [Fact]
    public void Load_PartialFile_MergesWithDefaults()
    {
        var configPath = Path.Combine(_testDir, "partial.json");
        var json = """{ "database": "partial.db" }""";
        File.WriteAllText(configPath, json);

        var config = TiaCCConfig.Load(configPath);

        Assert.Equal("partial.db", config.Database);
        Assert.NotNull(config.TestRunner);
        Assert.NotNull(config.Coverage);
    }

    [Fact]
    public void Load_NestedConfig_LoadsCorrectly()
    {
        var configPath = Path.Combine(_testDir, "nested.json");
        var json = """
        {
            "database": "test.db",
            "testRunner": {
                "command": "pytest",
                "args": "-v"
            },
            "git": {
                "baseBranch": "develop"
            }
        }
        """;
        File.WriteAllText(configPath, json);

        var config = TiaCCConfig.Load(configPath);

        Assert.Equal("pytest", config.TestRunner.Command);
        Assert.Equal("-v", config.TestRunner.Args);
        Assert.Equal("develop", config.Git.BaseBranch);
    }

    #endregion

    #region Save Tests

    [Fact]
    public void Save_CreatesFile()
    {
        var configPath = Path.Combine(_testDir, "save_test.json");
        var config = new TiaCCConfig { Database = "saved.db" };

        config.Save(configPath);

        Assert.True(File.Exists(configPath));
    }

    [Fact]
    public void Save_CreatesDirectory()
    {
        var configPath = Path.Combine(_testDir, "subdir", "config.json");
        var config = new TiaCCConfig();

        config.Save(configPath);

        Assert.True(Directory.Exists(Path.Combine(_testDir, "subdir")));
        Assert.True(File.Exists(configPath));
    }

    [Fact]
    public void Save_ThenLoad_RoundTrips()
    {
        var configPath = Path.Combine(_testDir, "roundtrip.json");
        var original = new TiaCCConfig
        {
            Database = "roundtrip.db",
            SourcePatterns = ["*.custom"],
            TestRunner = new TestRunnerConfig { Command = "npm test" }
        };

        original.Save(configPath);
        var loaded = TiaCCConfig.Load(configPath);

        Assert.Equal(original.Database, loaded.Database);
        Assert.Equal(original.SourcePatterns, loaded.SourcePatterns);
        Assert.Equal(original.TestRunner.Command, loaded.TestRunner.Command);
    }

    [Fact]
    public void Save_ProducesValidJson()
    {
        var configPath = Path.Combine(_testDir, "valid.json");
        var config = new TiaCCConfig();

        config.Save(configPath);

        var json = File.ReadAllText(configPath);
        var exception = Record.Exception(() => JsonDocument.Parse(json));
        Assert.Null(exception);
    }

    #endregion

    #region FindConfigFile Tests

    [Fact]
    public void FindConfigFile_NoConfig_ReturnsNull()
    {
        var result = TiaCCConfig.FindConfigFile(_testDir);
        Assert.Null(result);
    }

    [Fact]
    public void FindConfigFile_ConfigInTiaccDir_ReturnsPath()
    {
        var tiaccDir = Path.Combine(_testDir, ".tiacc");
        Directory.CreateDirectory(tiaccDir);
        var configPath = Path.Combine(tiaccDir, "config.json");
        File.WriteAllText(configPath, "{}");

        var result = TiaCCConfig.FindConfigFile(_testDir);

        Assert.Equal(configPath, result);
    }

    [Fact]
    public void FindConfigFile_TiaccJsonInRoot_ReturnsPath()
    {
        var configPath = Path.Combine(_testDir, "tiacc.json");
        File.WriteAllText(configPath, "{}");

        var result = TiaCCConfig.FindConfigFile(_testDir);

        Assert.Equal(configPath, result);
    }

    [Fact]
    public void FindConfigFile_ConfigInParentDir_ReturnsPath()
    {
        var childDir = Path.Combine(_testDir, "child", "grandchild");
        Directory.CreateDirectory(childDir);
        var configPath = Path.Combine(_testDir, "tiacc.json");
        File.WriteAllText(configPath, "{}");

        var result = TiaCCConfig.FindConfigFile(childDir);

        Assert.Equal(configPath, result);
    }

    [Fact]
    public void FindConfigFile_PrefersNestedTiaccDir()
    {
        // Create both .tiacc/config.json and tiacc.json
        var tiaccDir = Path.Combine(_testDir, ".tiacc");
        Directory.CreateDirectory(tiaccDir);
        var tiaccConfig = Path.Combine(tiaccDir, "config.json");
        File.WriteAllText(tiaccConfig, "{}");

        var rootConfig = Path.Combine(_testDir, "tiacc.json");
        File.WriteAllText(rootConfig, "{}");

        var result = TiaCCConfig.FindConfigFile(_testDir);

        // .tiacc/config.json should be preferred
        Assert.Equal(tiaccConfig, result);
    }

    #endregion

    #region GetDefaultPath Tests

    [Fact]
    public void GetDefaultPath_ReturnsCorrectPath()
    {
        var result = TiaCCConfig.GetDefaultPath("/project");
        Assert.Equal(Path.Combine("/project", ".tiacc", "config.json"), result);
    }

    #endregion
}
