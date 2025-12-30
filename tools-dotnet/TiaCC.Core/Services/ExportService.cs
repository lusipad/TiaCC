using System.Text.Json;
using System.Text.Json.Serialization;
using TiaCC.Core.Models;

namespace TiaCC.Core.Services;

/// <summary>
/// Exports database data to JSON format for dashboard consumption
/// </summary>
public class ExportService
{
    private readonly DatabaseService _db;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public ExportService(DatabaseService db)
    {
        _db = db;
    }

    /// <summary>
    /// Export all data to the specified output directory
    /// </summary>
    public async Task ExportAllAsync(string outputDir)
    {
        Directory.CreateDirectory(outputDir);

        await Task.WhenAll(
            ExportStatsAsync(Path.Combine(outputDir, "stats.json")),
            ExportSourceFilesAsync(Path.Combine(outputDir, "source-files.json")),
            ExportTestScriptsAsync(Path.Combine(outputDir, "test-scripts.json")),
            ExportMappingsAsync(Path.Combine(outputDir, "mappings.json")),
            ExportDirectoryCoverageAsync(Path.Combine(outputDir, "directory-coverage.json")),
            ExportGraphAsync(Path.Combine(outputDir, "graph.json")),
            ExportSymbolsAsync(Path.Combine(outputDir, "symbols.json"))
        );
    }

    public async Task ExportStatsAsync(string outputPath)
    {
        var stats = await _db.GetStatsAsync();
        var json = JsonSerializer.Serialize(stats, JsonOptions);
        await File.WriteAllTextAsync(outputPath, json);
    }

    public async Task ExportSourceFilesAsync(string outputPath)
    {
        var files = await _db.GetAllSourceFilesAsync();
        var data = files.Select(f => new
        {
            f.Id,
            f.FilePath,
            f.FileHash,
            f.LastUpdated
        });
        var json = JsonSerializer.Serialize(data, JsonOptions);
        await File.WriteAllTextAsync(outputPath, json);
    }

    public async Task ExportTestScriptsAsync(string outputPath)
    {
        var tests = await _db.GetAllTestScriptsAsync();
        var data = tests.Select(t => new
        {
            t.Id,
            t.ScriptPath,
            t.LastRun,
            t.AvgDurationMs
        });
        var json = JsonSerializer.Serialize(data, JsonOptions);
        await File.WriteAllTextAsync(outputPath, json);
    }

    public async Task ExportMappingsAsync(string outputPath)
    {
        var mappings = await _db.GetAllMappingsAsync();
        var data = mappings.Select(m => new
        {
            SourceFile = m.SourceFile.FilePath,
            TestScript = m.TestScript.ScriptPath,
            LineCoveragePct = m.LineCoveragePct,
            m.CreatedAt
        });
        var json = JsonSerializer.Serialize(data, JsonOptions);
        await File.WriteAllTextAsync(outputPath, json);
    }

    public async Task ExportDirectoryCoverageAsync(string outputPath)
    {
        var coverage = await _db.GetCoverageByDirectoryAsync();
        var json = JsonSerializer.Serialize(coverage, JsonOptions);
        await File.WriteAllTextAsync(outputPath, json);
    }

    public async Task ExportGraphAsync(string outputPath)
    {
        var sourceFiles = await _db.GetAllSourceFilesAsync();
        var testScripts = await _db.GetAllTestScriptsAsync();
        var mappings = await _db.GetAllMappingsAsync();
        var symbols = await _db.GetAllSymbolsAsync();

        var nodes = new List<object>();
        var links = new List<object>();

        // Source file nodes
        foreach (var sf in sourceFiles)
        {
            nodes.Add(new
            {
                Id = $"source:{sf.Id}",
                Type = "source",
                Label = Path.GetFileName(sf.FilePath)
            });
        }

        // Test nodes
        foreach (var ts in testScripts)
        {
            nodes.Add(new
            {
                Id = $"test:{ts.Id}",
                Type = "test",
                Label = ts.ScriptPath
            });
        }

        // Function nodes
        foreach (var sym in symbols)
        {
            nodes.Add(new
            {
                Id = $"func:{sym.Id}",
                Type = "function",
                Label = sym.SymbolName,
                Parent = $"source:{sym.SourceFileId}",
                sym.StartLine,
                sym.EndLine
            });
        }

        // Source -> Test links
        foreach (var m in mappings)
        {
            links.Add(new
            {
                Source = $"source:{m.SourceFileId}",
                Target = $"test:{m.TestScriptId}",
                Coverage = m.LineCoveragePct
            });
        }

        // Function -> Test links
        foreach (var sym in symbols)
        {
            foreach (var sc in sym.SymbolCoverages)
            {
                links.Add(new
                {
                    Source = $"func:{sym.Id}",
                    Target = $"test:{sc.TestScriptId}",
                    Coverage = sc.CoveragePct
                });
            }
        }

        var graph = new { Nodes = nodes, Links = links };
        var json = JsonSerializer.Serialize(graph, JsonOptions);
        await File.WriteAllTextAsync(outputPath, json);
    }

    public async Task ExportSymbolsAsync(string outputPath)
    {
        var symbols = await _db.GetAllSymbolsAsync();
        var stats = await _db.GetStatsAsync();

        var symbolData = symbols.Select(s => new
        {
            SymbolId = s.Id,
            s.SymbolName,
            SourceFile = s.SourceFile.FilePath,
            s.StartLine,
            s.EndLine,
            Type = s.SymbolType,
            Tests = s.SymbolCoverages.Select(sc => new
            {
                TestPath = sc.TestScript.ScriptPath,
                Coverage = sc.CoveragePct
            })
        });

        var data = new
        {
            Symbols = symbolData,
            Stats = new
            {
                Symbols = stats.SymbolCount,
                SymbolMappings = symbols.Sum(s => s.SymbolCoverages.Count)
            }
        };

        var json = JsonSerializer.Serialize(data, JsonOptions);
        await File.WriteAllTextAsync(outputPath, json);
    }
}
