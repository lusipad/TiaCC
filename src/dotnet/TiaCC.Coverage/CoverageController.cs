using System.Diagnostics;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace TiaCC.Coverage;

/// <summary>
/// Controller for managing code coverage collection in .NET applications.
/// Uses coverlet for actual coverage instrumentation.
/// </summary>
public class CoverageController : IDisposable
{
    private readonly string _outputDir;
    private readonly ILogger<CoverageController> _logger;
    private readonly object _lock = new();

    private string? _currentTestId;
    private bool _isRecording;
    private DateTime _recordingStartTime;
    private bool _disposed;

    public CoverageController(string outputDir, ILogger<CoverageController>? logger = null)
    {
        _outputDir = outputDir;
        _logger = logger ?? NullLogger<CoverageController>.Instance;

        // Ensure output directory exists
        Directory.CreateDirectory(_outputDir);
    }

    /// <summary>
    /// Gets whether coverage is currently being recorded.
    /// </summary>
    public bool IsRecording
    {
        get
        {
            lock (_lock)
            {
                return _isRecording;
            }
        }
    }

    /// <summary>
    /// Gets the current test ID being recorded, or null if not recording.
    /// </summary>
    public string? CurrentTestId
    {
        get
        {
            lock (_lock)
            {
                return _currentTestId;
            }
        }
    }

    /// <summary>
    /// Starts recording coverage for a test.
    /// </summary>
    /// <param name="testId">Unique identifier for the test</param>
    /// <returns>True if recording started successfully</returns>
    public bool StartRecording(string testId)
    {
        ArgumentNullException.ThrowIfNull(testId);

        lock (_lock)
        {
            if (_isRecording)
            {
                _logger.LogWarning("Already recording test '{CurrentTestId}'", _currentTestId);
                return false;
            }

            _currentTestId = testId;
            _isRecording = true;
            _recordingStartTime = DateTime.UtcNow;

            _logger.LogInformation("Started recording coverage for test '{TestId}'", testId);
            return true;
        }
    }

    /// <summary>
    /// Stops the current recording session.
    /// </summary>
    /// <returns>True if recording stopped successfully</returns>
    public bool StopRecording()
    {
        lock (_lock)
        {
            if (!_isRecording)
            {
                return false;
            }

            _isRecording = false;
            var duration = DateTime.UtcNow - _recordingStartTime;
            _logger.LogInformation(
                "Stopped recording coverage for test '{TestId}' (duration: {Duration}ms)",
                _currentTestId, duration.TotalMilliseconds);

            return true;
        }
    }

    /// <summary>
    /// Gets the coverage result for the current or last recording session.
    /// Note: Actual coverage data extraction requires coverlet integration.
    /// </summary>
    /// <returns>Coverage result containing file paths</returns>
    public CoverageResult GetResult()
    {
        lock (_lock)
        {
            return new CoverageResult
            {
                TestId = _currentTestId ?? "",
                OutputPath = GetOutputPath(_currentTestId ?? "unknown"),
                Timestamp = DateTime.UtcNow
            };
        }
    }

    /// <summary>
    /// Dumps coverage data to a file.
    /// </summary>
    /// <param name="outputPath">Optional custom output path. If null, uses default path.</param>
    /// <returns>The path where coverage was written, or null on failure</returns>
    public string? DumpToFile(string? outputPath = null)
    {
        lock (_lock)
        {
            var testId = _currentTestId ?? "unknown";
            var path = outputPath ?? GetOutputPath(testId);

            try
            {
                // Ensure directory exists
                var dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                // Write metadata file
                // Note: Actual coverage data would be written by coverlet
                var metadata = new CoverageMetadata
                {
                    TestId = testId,
                    Timestamp = DateTime.UtcNow,
                    DurationMs = (DateTime.UtcNow - _recordingStartTime).TotalMilliseconds
                };

                var metadataPath = Path.ChangeExtension(path, ".metadata.json");
                var json = JsonSerializer.Serialize(metadata, new JsonSerializerOptions
                {
                    WriteIndented = true
                });
                File.WriteAllText(metadataPath, json);

                _logger.LogInformation("Coverage metadata written to '{Path}'", metadataPath);
                return path;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to dump coverage to '{Path}'", path);
                return null;
            }
        }
    }

    private string GetOutputPath(string testId)
    {
        // Sanitize test ID for use as filename
        var safeTestId = string.Join("_", testId.Split(Path.GetInvalidFileNameChars()));
        return Path.Combine(_outputDir, $"{safeTestId}.coverage.json");
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            if (_isRecording)
            {
                StopRecording();
            }
            _disposed = true;
        }
        GC.SuppressFinalize(this);
    }
}

/// <summary>
/// Represents the result of a coverage recording session.
/// </summary>
public class CoverageResult
{
    public required string TestId { get; init; }
    public required string OutputPath { get; init; }
    public DateTime Timestamp { get; init; }
    public List<string> CoveredFiles { get; init; } = new();
}

/// <summary>
/// Metadata stored alongside coverage data.
/// </summary>
public class CoverageMetadata
{
    public required string TestId { get; init; }
    public DateTime Timestamp { get; init; }
    public double DurationMs { get; init; }
}
