using System.Diagnostics;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace TiaCC.Coverage;

/// <summary>
/// Integration with coverlet for collecting .NET code coverage.
///
/// Coverlet can be used in three modes:
/// 1. MSBuild integration (coverlet.msbuild) - integrated into build process
/// 2. .NET tool (dotnet-coverage) - standalone tool
/// 3. Collector mode (coverlet.collector) - for dotnet test
///
/// This class provides programmatic control for runtime coverage collection.
/// </summary>
public class CoverletIntegration : IDisposable
{
    private readonly string _outputDir;
    private readonly string _targetAssembly;
    private readonly ILogger<CoverletIntegration> _logger;
    private Process? _coverletProcess;
    private bool _disposed;

    /// <summary>
    /// Creates a new coverlet integration instance.
    /// </summary>
    /// <param name="outputDir">Directory to store coverage output</param>
    /// <param name="targetAssembly">Path to the assembly to instrument</param>
    /// <param name="logger">Optional logger</param>
    public CoverletIntegration(
        string outputDir,
        string targetAssembly,
        ILogger<CoverletIntegration>? logger = null)
    {
        _outputDir = outputDir;
        _targetAssembly = targetAssembly;
        _logger = logger ?? NullLogger<CoverletIntegration>.Instance;

        Directory.CreateDirectory(_outputDir);
    }

    /// <summary>
    /// Runs a test with coverage collection using coverlet.
    /// </summary>
    /// <param name="testId">Unique test identifier</param>
    /// <param name="testCommand">Command to run the test (e.g., "dotnet test")</param>
    /// <param name="testArgs">Arguments for the test command</param>
    /// <returns>Coverage result with output file path</returns>
    public async Task<CoverletResult> RunWithCoverageAsync(
        string testId,
        string testCommand,
        string testArgs = "",
        CancellationToken cancellationToken = default)
    {
        var outputPath = GetOutputPath(testId);
        var startTime = DateTime.UtcNow;

        try
        {
            // Build coverlet command
            // coverlet <assembly> --target <command> --targetargs <args> --output <path> --format json
            var coverletArgs = BuildCoverletArgs(testCommand, testArgs, outputPath);

            _logger.LogInformation("Running coverlet for test '{TestId}'", testId);
            _logger.LogDebug("Coverlet args: {Args}", coverletArgs);

            var processInfo = new ProcessStartInfo
            {
                FileName = "coverlet",
                Arguments = coverletArgs,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = Process.Start(processInfo);
            if (process == null)
            {
                return new CoverletResult
                {
                    TestId = testId,
                    Success = false,
                    Error = "Failed to start coverlet process"
                };
            }

            _coverletProcess = process;

            var output = await process.StandardOutput.ReadToEndAsync(cancellationToken);
            var error = await process.StandardError.ReadToEndAsync(cancellationToken);

            await process.WaitForExitAsync(cancellationToken);

            var duration = DateTime.UtcNow - startTime;

            if (process.ExitCode != 0)
            {
                _logger.LogError("Coverlet failed with exit code {ExitCode}: {Error}",
                    process.ExitCode, error);

                return new CoverletResult
                {
                    TestId = testId,
                    Success = false,
                    Error = error,
                    DurationMs = duration.TotalMilliseconds
                };
            }

            // Parse coverage output
            var coverageData = await ParseCoverageOutputAsync(outputPath, cancellationToken);

            return new CoverletResult
            {
                TestId = testId,
                Success = true,
                OutputPath = outputPath,
                DurationMs = duration.TotalMilliseconds,
                LineCoverage = coverageData.LineCoverage,
                BranchCoverage = coverageData.BranchCoverage,
                CoveredFiles = coverageData.CoveredFiles
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error running coverlet for test '{TestId}'", testId);

            return new CoverletResult
            {
                TestId = testId,
                Success = false,
                Error = ex.Message
            };
        }
        finally
        {
            _coverletProcess = null;
        }
    }

    /// <summary>
    /// Merges multiple coverage files into a single report.
    /// </summary>
    /// <param name="coverageFiles">List of coverage file paths</param>
    /// <param name="outputPath">Output path for merged coverage</param>
    public async Task<bool> MergeCoverageAsync(
        IEnumerable<string> coverageFiles,
        string outputPath,
        CancellationToken cancellationToken = default)
    {
        try
        {
            // Use dotnet-coverage merge or manual JSON merging
            var files = coverageFiles.ToList();
            if (files.Count == 0) return false;
            if (files.Count == 1)
            {
                File.Copy(files[0], outputPath, overwrite: true);
                return true;
            }

            // Manual JSON merge for coverlet JSON format
            var mergedData = new Dictionary<string, Dictionary<string, Dictionary<string, Dictionary<string, int>>>>();

            foreach (var file in files)
            {
                if (!File.Exists(file)) continue;

                var content = await File.ReadAllTextAsync(file, cancellationToken);
                var data = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, Dictionary<string, Dictionary<string, int>>>>>(content);

                if (data == null) continue;

                foreach (var (module, moduleData) in data)
                {
                    if (!mergedData.ContainsKey(module))
                    {
                        mergedData[module] = new Dictionary<string, Dictionary<string, Dictionary<string, int>>>();
                    }

                    foreach (var (file2, fileData) in moduleData)
                    {
                        if (!mergedData[module].ContainsKey(file2))
                        {
                            mergedData[module][file2] = new Dictionary<string, Dictionary<string, int>>();
                        }

                        foreach (var (method, methodData) in fileData)
                        {
                            if (!mergedData[module][file2].ContainsKey(method))
                            {
                                mergedData[module][file2][method] = new Dictionary<string, int>();
                            }

                            foreach (var (line, hits) in methodData)
                            {
                                if (mergedData[module][file2][method].TryGetValue(line, out var existing))
                                {
                                    mergedData[module][file2][method][line] = existing + hits;
                                }
                                else
                                {
                                    mergedData[module][file2][method][line] = hits;
                                }
                            }
                        }
                    }
                }
            }

            var json = JsonSerializer.Serialize(mergedData, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(outputPath, json, cancellationToken);

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error merging coverage files");
            return false;
        }
    }

    private string BuildCoverletArgs(string testCommand, string testArgs, string outputPath)
    {
        var args = new List<string>
        {
            Quote(_targetAssembly),
            "--target", Quote(testCommand),
            "--output", Quote(outputPath),
            "--format", "json"
        };

        if (!string.IsNullOrEmpty(testArgs))
        {
            args.Add("--targetargs");
            args.Add(Quote(testArgs));
        }

        return string.Join(" ", args);
    }

    private static string Quote(string value)
    {
        if (value.Contains(' ') && !value.StartsWith('"'))
        {
            return $"\"{value}\"";
        }
        return value;
    }

    private string GetOutputPath(string testId)
    {
        var safeTestId = string.Join("_", testId.Split(Path.GetInvalidFileNameChars()));
        return Path.Combine(_outputDir, $"{safeTestId}.coverage.json");
    }

    private async Task<CoverageData> ParseCoverageOutputAsync(
        string outputPath,
        CancellationToken cancellationToken)
    {
        var result = new CoverageData();

        if (!File.Exists(outputPath))
        {
            return result;
        }

        try
        {
            var content = await File.ReadAllTextAsync(outputPath, cancellationToken);
            using var doc = JsonDocument.Parse(content);

            int totalLines = 0;
            int coveredLines = 0;
            var files = new HashSet<string>();

            foreach (var module in doc.RootElement.EnumerateObject())
            {
                foreach (var file in module.Value.EnumerateObject())
                {
                    files.Add(file.Name);

                    foreach (var method in file.Value.EnumerateObject())
                    {
                        if (method.Value.TryGetProperty("Lines", out var lines))
                        {
                            foreach (var line in lines.EnumerateObject())
                            {
                                totalLines++;
                                if (line.Value.GetInt32() > 0)
                                {
                                    coveredLines++;
                                }
                            }
                        }
                    }
                }
            }

            result.LineCoverage = totalLines > 0 ? (double)coveredLines / totalLines * 100 : 0;
            result.CoveredFiles = files.ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error parsing coverage output");
        }

        return result;
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _coverletProcess?.Kill();
            _coverletProcess?.Dispose();
            _disposed = true;
        }
        GC.SuppressFinalize(this);
    }

    private class CoverageData
    {
        public double LineCoverage { get; set; }
        public double BranchCoverage { get; set; }
        public List<string> CoveredFiles { get; set; } = new();
    }
}

/// <summary>
/// Result of a coverlet coverage collection run.
/// </summary>
public class CoverletResult
{
    public required string TestId { get; init; }
    public bool Success { get; init; }
    public string? OutputPath { get; init; }
    public string? Error { get; init; }
    public double DurationMs { get; init; }
    public double LineCoverage { get; init; }
    public double BranchCoverage { get; init; }
    public List<string> CoveredFiles { get; init; } = new();
}
