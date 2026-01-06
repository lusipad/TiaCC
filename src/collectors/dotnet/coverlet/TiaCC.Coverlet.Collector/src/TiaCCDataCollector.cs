using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Xml;
using Microsoft.VisualStudio.TestPlatform.ObjectModel;
using Microsoft.VisualStudio.TestPlatform.ObjectModel.DataCollection;

namespace TiaCC.Coverlet.Collector;

/// <summary>
/// TiaCC Data Collector for per-test coverage collection.
/// Wraps Coverlet to produce separate coverage files per test method.
/// </summary>
[DataCollectorFriendlyName("TiaCC Coverage")]
[DataCollectorTypeUri("datacollector://TiaCC/CoverageCollector/1.0")]
public class TiaCCDataCollector : DataCollector
{
    private DataCollectionContext? _context;
    private DataCollectionLogger? _logger;
    private DataCollectionSink? _dataSink;
    private string _outputDirectory = ".tiacc/coverage";
    private readonly Dictionary<Guid, TestInfo> _runningTests = new();

    private class TestInfo
    {
        public string FullName { get; set; } = "";
        public DateTime StartTime { get; set; }
        public string SafeFileName => SanitizeFileName(FullName);

        private static string SanitizeFileName(string name)
        {
            // Replace invalid characters for file names
            var invalid = Path.GetInvalidFileNameChars();
            foreach (var c in invalid)
            {
                name = name.Replace(c, '_');
            }
            // Replace dots with underscores except the last one
            var parts = name.Split('.');
            if (parts.Length > 1)
            {
                name = string.Join("__", parts);
            }
            return name;
        }
    }

    public override void Initialize(
        XmlElement? configurationElement,
        DataCollectionEvents events,
        DataCollectionSink dataSink,
        DataCollectionLogger logger,
        DataCollectionEnvironmentContext? environmentContext)
    {
        _dataSink = dataSink;
        _logger = logger;
        _context = environmentContext?.SessionDataCollectionContext;

        // Parse configuration
        if (configurationElement != null)
        {
            var outputDir = configurationElement.GetAttribute("OutputDirectory");
            if (!string.IsNullOrEmpty(outputDir))
            {
                _outputDirectory = outputDir;
            }
        }

        // Ensure output directory exists
        Directory.CreateDirectory(_outputDirectory);

        // Subscribe to test events
        events.TestCaseStart += OnTestCaseStart;
        events.TestCaseEnd += OnTestCaseEnd;
        events.SessionEnd += OnSessionEnd;

        _logger?.LogWarning(_context, "[TiaCC] Data collector initialized. Output: " + _outputDirectory);
    }

    private void OnTestCaseStart(object? sender, TestCaseStartEventArgs e)
    {
        var testInfo = new TestInfo
        {
            FullName = e.TestCaseId != Guid.Empty ? e.TestElement.FullyQualifiedName : "Unknown",
            StartTime = DateTime.UtcNow
        };

        _runningTests[e.TestCaseId] = testInfo;

        _logger?.LogWarning(_context, $"[TiaCC] Test started: {testInfo.FullName}");

        // Signal to Coverlet to start tracking (via environment variable)
        Environment.SetEnvironmentVariable("TIACC_CURRENT_TEST", testInfo.FullName);
    }

    private void OnTestCaseEnd(object? sender, TestCaseEndEventArgs e)
    {
        if (!_runningTests.TryGetValue(e.TestCaseId, out var testInfo))
        {
            return;
        }

        _runningTests.Remove(e.TestCaseId);

        _logger?.LogWarning(_context, $"[TiaCC] Test ended: {testInfo.FullName} ({e.TestOutcome})");

        // Clear the current test marker
        Environment.SetEnvironmentVariable("TIACC_CURRENT_TEST", null);

        // Write a marker file for this test
        // The actual coverage merging happens in post-processing
        var markerPath = Path.Combine(_outputDirectory, $"{testInfo.SafeFileName}.marker");
        var markerData = new
        {
            testId = testInfo.FullName,
            startTime = testInfo.StartTime.ToString("O"),
            endTime = DateTime.UtcNow.ToString("O"),
            outcome = e.TestOutcome.ToString()
        };

        try
        {
            File.WriteAllText(markerPath, JsonSerializer.Serialize(markerData, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            _logger?.LogError(_context, $"[TiaCC] Failed to write marker: {ex.Message}");
        }
    }

    private void OnSessionEnd(object? sender, SessionEndEventArgs e)
    {
        _logger?.LogWarning(_context, "[TiaCC] Test session ended. Coverage data written to: " + _outputDirectory);

        // Write session summary
        var summaryPath = Path.Combine(_outputDirectory, "_session_summary.json");
        var summary = new
        {
            timestamp = DateTime.UtcNow.ToString("O"),
            testsRun = _runningTests.Count,
            outputDirectory = _outputDirectory
        };

        try
        {
            File.WriteAllText(summaryPath, JsonSerializer.Serialize(summary, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch
        {
            // Ignore errors during cleanup
        }
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
    }
}
