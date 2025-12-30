using System.Text.Json;
using System.Text.Json.Serialization;

namespace TiaCC.Core.Models;

/// <summary>
/// Configuration file model for TiaCC (.tiacc/config.json)
/// </summary>
public class TiaCCConfig
{
    /// <summary>
    /// Path to the SQLite database file
    /// </summary>
    [JsonPropertyName("database")]
    public string Database { get; set; } = "impact_map.db";

    /// <summary>
    /// Source file patterns to include
    /// </summary>
    [JsonPropertyName("sourcePatterns")]
    public List<string> SourcePatterns { get; set; } = ["*.cpp", "*.c", "*.h", "*.hpp", "*.cs", "*.py", "*.ts", "*.tsx", "*.js", "*.jsx"];

    /// <summary>
    /// Directories to exclude from scanning
    /// </summary>
    [JsonPropertyName("excludeDirs")]
    public List<string> ExcludeDirs { get; set; } = ["node_modules", "bin", "obj", ".git", "build", "dist"];

    /// <summary>
    /// Test runner configuration
    /// </summary>
    [JsonPropertyName("testRunner")]
    public TestRunnerConfig TestRunner { get; set; } = new();

    /// <summary>
    /// Coverage configuration
    /// </summary>
    [JsonPropertyName("coverage")]
    public CoverageConfig Coverage { get; set; } = new();

    /// <summary>
    /// Git configuration
    /// </summary>
    [JsonPropertyName("git")]
    public GitConfig Git { get; set; } = new();

    /// <summary>
    /// Dashboard export configuration
    /// </summary>
    [JsonPropertyName("dashboard")]
    public DashboardConfig Dashboard { get; set; } = new();

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    /// <summary>
    /// Load configuration from file
    /// </summary>
    public static TiaCCConfig Load(string path)
    {
        if (!File.Exists(path))
        {
            return new TiaCCConfig();
        }

        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<TiaCCConfig>(json, JsonOptions) ?? new TiaCCConfig();
    }

    /// <summary>
    /// Save configuration to file
    /// </summary>
    public void Save(string path)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
        {
            Directory.CreateDirectory(dir);
        }

        var json = JsonSerializer.Serialize(this, JsonOptions);
        File.WriteAllText(path, json);
    }

    /// <summary>
    /// Find configuration file in current or parent directories
    /// </summary>
    public static string? FindConfigFile(string startDir)
    {
        var dir = startDir;
        while (!string.IsNullOrEmpty(dir))
        {
            var configPath = Path.Combine(dir, ".tiacc", "config.json");
            if (File.Exists(configPath))
            {
                return configPath;
            }

            // Also check for tiacc.json in root
            configPath = Path.Combine(dir, "tiacc.json");
            if (File.Exists(configPath))
            {
                return configPath;
            }

            dir = Path.GetDirectoryName(dir);
        }

        return null;
    }

    /// <summary>
    /// Get default configuration file path
    /// </summary>
    public static string GetDefaultPath(string baseDir)
    {
        return Path.Combine(baseDir, ".tiacc", "config.json");
    }
}

/// <summary>
/// Test runner configuration
/// </summary>
public class TestRunnerConfig
{
    /// <summary>
    /// Test runner command (e.g., "dotnet test", "pytest", "npm test")
    /// </summary>
    [JsonPropertyName("command")]
    public string Command { get; set; } = "dotnet test";

    /// <summary>
    /// Additional arguments to pass to the test runner
    /// </summary>
    [JsonPropertyName("args")]
    public string? Args { get; set; }

    /// <summary>
    /// Working directory for running tests
    /// </summary>
    [JsonPropertyName("workingDir")]
    public string? WorkingDir { get; set; }

    /// <summary>
    /// Test file patterns (for filtering)
    /// </summary>
    [JsonPropertyName("testPatterns")]
    public List<string> TestPatterns { get; set; } = ["*Tests.cs", "*Test.cs", "test_*.py", "*.test.ts", "*.spec.ts"];
}

/// <summary>
/// Coverage collection configuration
/// </summary>
public class CoverageConfig
{
    /// <summary>
    /// Coverage format (auto, llvm, coverlet, cobertura, lcov, jacoco, istanbul, etc.)
    /// </summary>
    [JsonPropertyName("format")]
    public string Format { get; set; } = "auto";

    /// <summary>
    /// Path to coverage file or directory
    /// </summary>
    [JsonPropertyName("path")]
    public string Path { get; set; } = "coverage";

    /// <summary>
    /// Coverage file pattern
    /// </summary>
    [JsonPropertyName("pattern")]
    public string Pattern { get; set; } = "*.json";

    /// <summary>
    /// Base directory for resolving relative paths in coverage data
    /// </summary>
    [JsonPropertyName("baseDir")]
    public string? BaseDir { get; set; }
}

/// <summary>
/// Git integration configuration
/// </summary>
public class GitConfig
{
    /// <summary>
    /// Default base branch for comparisons
    /// </summary>
    [JsonPropertyName("baseBranch")]
    public string BaseBranch { get; set; } = "main";

    /// <summary>
    /// Include uncommitted changes by default
    /// </summary>
    [JsonPropertyName("includeUncommitted")]
    public bool IncludeUncommitted { get; set; } = true;

    /// <summary>
    /// File patterns to ignore in Git diff
    /// </summary>
    [JsonPropertyName("ignorePatterns")]
    public List<string> IgnorePatterns { get; set; } = ["*.md", "*.txt", "*.json", "*.yaml", "*.yml"];
}

/// <summary>
/// Dashboard export configuration
/// </summary>
public class DashboardConfig
{
    /// <summary>
    /// Output directory for dashboard data
    /// </summary>
    [JsonPropertyName("outputDir")]
    public string OutputDir { get; set; } = "./dashboard/data";

    /// <summary>
    /// Export format (json, html)
    /// </summary>
    [JsonPropertyName("format")]
    public string Format { get; set; } = "json";

    /// <summary>
    /// Include graph data in export
    /// </summary>
    [JsonPropertyName("includeGraph")]
    public bool IncludeGraph { get; set; } = true;

    /// <summary>
    /// Include treemap data in export
    /// </summary>
    [JsonPropertyName("includeTreemap")]
    public bool IncludeTreemap { get; set; } = true;
}
