using System.Text.Json;
using TiaCC.Core.Services;
using Xunit;

namespace TiaCC.Core.Tests;

public class ExportServiceTests : IDisposable
{
    private readonly string _testDir;
    private readonly string _dbPath;
    private readonly string _outputDir;

    public ExportServiceTests()
    {
        _testDir = Path.Combine(Path.GetTempPath(), $"tiacc_export_test_{Guid.NewGuid():N}");
        Directory.CreateDirectory(_testDir);
        _dbPath = Path.Combine(_testDir, "test.db");
        _outputDir = Path.Combine(_testDir, "output");
    }

    public void Dispose()
    {
        if (Directory.Exists(_testDir))
            Directory.Delete(_testDir, true);
        GC.SuppressFinalize(this);
    }

    private async Task<DatabaseService> CreateDatabaseWithDataAsync()
    {
        var db = new DatabaseService(_dbPath);
        await db.InitializeAsync();

        // Add source files
        var file1 = await db.GetOrCreateSourceFileAsync("TiaCC.Core/Services/DatabaseService.cs");
        var file2 = await db.GetOrCreateSourceFileAsync("TiaCC.Core/Services/CoverageParser.cs");

        // Add test scripts
        var test1 = await db.GetOrCreateTestScriptAsync("DatabaseServiceTests");
        var test2 = await db.GetOrCreateTestScriptAsync("CoverageParserTests");

        // Add coverage mappings
        await db.UpsertCoverageMapAsync(file1.Id, test1.Id, 85.5);
        await db.UpsertCoverageMapAsync(file2.Id, test2.Id, 78.3);
        await db.UpsertCoverageMapAsync(file1.Id, test2.Id, 15.0);

        // Add symbols
        var symbol1 = await db.GetOrCreateSymbolAsync(file1.Id, "InitializeAsync", "method", 23, 26);
        var symbol2 = await db.GetOrCreateSymbolAsync(file1.Id, "GetSourceFileAsync", "method", 38, 42);

        // Add symbol coverage
        await db.UpsertSymbolCoverageAsync(symbol1.Id, test1.Id, 100.0);
        await db.UpsertSymbolCoverageAsync(symbol2.Id, test1.Id, 90.0);

        return db;
    }

    #region ExportAllAsync Tests

    [Fact]
    public async Task ExportAllAsync_CreatesAllFiles()
    {
        using var db = await CreateDatabaseWithDataAsync();
        var exportService = new ExportService(db);

        await exportService.ExportAllAsync(_outputDir);

        Assert.True(File.Exists(Path.Combine(_outputDir, "stats.json")));
        Assert.True(File.Exists(Path.Combine(_outputDir, "source-files.json")));
        Assert.True(File.Exists(Path.Combine(_outputDir, "test-scripts.json")));
        Assert.True(File.Exists(Path.Combine(_outputDir, "mappings.json")));
        Assert.True(File.Exists(Path.Combine(_outputDir, "directory-coverage.json")));
        Assert.True(File.Exists(Path.Combine(_outputDir, "graph.json")));
        Assert.True(File.Exists(Path.Combine(_outputDir, "symbols.json")));
    }

    [Fact]
    public async Task ExportAllAsync_CreatesOutputDirectory()
    {
        using var db = await CreateDatabaseWithDataAsync();
        var exportService = new ExportService(db);
        var newOutputDir = Path.Combine(_testDir, "new_output");

        await exportService.ExportAllAsync(newOutputDir);

        Assert.True(Directory.Exists(newOutputDir));
    }

    #endregion

    #region ExportStatsAsync Tests

    [Fact]
    public async Task ExportStatsAsync_ExportsCorrectStats()
    {
        using var db = await CreateDatabaseWithDataAsync();
        var exportService = new ExportService(db);
        var outputPath = Path.Combine(_outputDir, "stats.json");
        Directory.CreateDirectory(_outputDir);

        await exportService.ExportStatsAsync(outputPath);

        var json = await File.ReadAllTextAsync(outputPath);
        var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal(2, root.GetProperty("sourceFileCount").GetInt32());
        Assert.Equal(2, root.GetProperty("testScriptCount").GetInt32());
        Assert.Equal(3, root.GetProperty("mappingCount").GetInt32());
        Assert.Equal(2, root.GetProperty("symbolCount").GetInt32());
    }

    #endregion

    #region ExportSourceFilesAsync Tests

    [Fact]
    public async Task ExportSourceFilesAsync_ExportsAllFiles()
    {
        using var db = await CreateDatabaseWithDataAsync();
        var exportService = new ExportService(db);
        var outputPath = Path.Combine(_outputDir, "source-files.json");
        Directory.CreateDirectory(_outputDir);

        await exportService.ExportSourceFilesAsync(outputPath);

        var json = await File.ReadAllTextAsync(outputPath);
        var doc = JsonDocument.Parse(json);
        var files = doc.RootElement.EnumerateArray().ToList();

        Assert.Equal(2, files.Count);
        Assert.Contains(files, f => f.GetProperty("filePath").GetString() == "TiaCC.Core/Services/DatabaseService.cs");
        Assert.Contains(files, f => f.GetProperty("filePath").GetString() == "TiaCC.Core/Services/CoverageParser.cs");
    }

    #endregion

    #region ExportTestScriptsAsync Tests

    [Fact]
    public async Task ExportTestScriptsAsync_ExportsAllTests()
    {
        using var db = await CreateDatabaseWithDataAsync();
        var exportService = new ExportService(db);
        var outputPath = Path.Combine(_outputDir, "test-scripts.json");
        Directory.CreateDirectory(_outputDir);

        await exportService.ExportTestScriptsAsync(outputPath);

        var json = await File.ReadAllTextAsync(outputPath);
        var doc = JsonDocument.Parse(json);
        var tests = doc.RootElement.EnumerateArray().ToList();

        Assert.Equal(2, tests.Count);
        Assert.Contains(tests, t => t.GetProperty("scriptPath").GetString() == "DatabaseServiceTests");
        Assert.Contains(tests, t => t.GetProperty("scriptPath").GetString() == "CoverageParserTests");
    }

    #endregion

    #region ExportMappingsAsync Tests

    [Fact]
    public async Task ExportMappingsAsync_ExportsAllMappings()
    {
        using var db = await CreateDatabaseWithDataAsync();
        var exportService = new ExportService(db);
        var outputPath = Path.Combine(_outputDir, "mappings.json");
        Directory.CreateDirectory(_outputDir);

        await exportService.ExportMappingsAsync(outputPath);

        var json = await File.ReadAllTextAsync(outputPath);
        var doc = JsonDocument.Parse(json);
        var mappings = doc.RootElement.EnumerateArray().ToList();

        Assert.Equal(3, mappings.Count);

        var dbServiceMapping = mappings.First(m =>
            m.GetProperty("sourceFile").GetString() == "TiaCC.Core/Services/DatabaseService.cs" &&
            m.GetProperty("testScript").GetString() == "DatabaseServiceTests");
        Assert.Equal(85.5, dbServiceMapping.GetProperty("lineCoveragePct").GetDouble());
    }

    #endregion

    #region ExportGraphAsync Tests

    [Fact]
    public async Task ExportGraphAsync_ExportsNodesAndLinks()
    {
        using var db = await CreateDatabaseWithDataAsync();
        var exportService = new ExportService(db);
        var outputPath = Path.Combine(_outputDir, "graph.json");
        Directory.CreateDirectory(_outputDir);

        await exportService.ExportGraphAsync(outputPath);

        var json = await File.ReadAllTextAsync(outputPath);
        var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var nodes = root.GetProperty("nodes").EnumerateArray().ToList();
        var links = root.GetProperty("links").EnumerateArray().ToList();

        // 2 source files + 2 test scripts + 2 symbols = 6 nodes
        Assert.Equal(6, nodes.Count);

        // Source nodes
        var sourceNodes = nodes.Where(n => n.GetProperty("type").GetString() == "source").ToList();
        Assert.Equal(2, sourceNodes.Count);

        // Test nodes
        var testNodes = nodes.Where(n => n.GetProperty("type").GetString() == "test").ToList();
        Assert.Equal(2, testNodes.Count);

        // Function nodes
        var funcNodes = nodes.Where(n => n.GetProperty("type").GetString() == "function").ToList();
        Assert.Equal(2, funcNodes.Count);

        // 3 source->test mappings + 2 symbol->test mappings = 5 links
        Assert.Equal(5, links.Count);
    }

    #endregion

    #region ExportSymbolsAsync Tests

    [Fact]
    public async Task ExportSymbolsAsync_ExportsSymbolData()
    {
        using var db = await CreateDatabaseWithDataAsync();
        var exportService = new ExportService(db);
        var outputPath = Path.Combine(_outputDir, "symbols.json");
        Directory.CreateDirectory(_outputDir);

        await exportService.ExportSymbolsAsync(outputPath);

        var json = await File.ReadAllTextAsync(outputPath);
        var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var symbols = root.GetProperty("symbols").EnumerateArray().ToList();
        var stats = root.GetProperty("stats");

        Assert.Equal(2, symbols.Count);
        Assert.Equal(2, stats.GetProperty("symbols").GetInt32());
        Assert.Equal(2, stats.GetProperty("symbolMappings").GetInt32());

        var initSymbol = symbols.First(s => s.GetProperty("symbolName").GetString() == "InitializeAsync");
        Assert.Equal("method", initSymbol.GetProperty("type").GetString());
        Assert.Equal(23, initSymbol.GetProperty("startLine").GetInt32());
        Assert.Equal(26, initSymbol.GetProperty("endLine").GetInt32());
    }

    #endregion

    #region ExportDirectoryCoverageAsync Tests

    [Fact]
    public async Task ExportDirectoryCoverageAsync_GroupsByDirectory()
    {
        using var db = await CreateDatabaseWithDataAsync();
        var exportService = new ExportService(db);
        var outputPath = Path.Combine(_outputDir, "directory-coverage.json");
        Directory.CreateDirectory(_outputDir);

        await exportService.ExportDirectoryCoverageAsync(outputPath);

        var json = await File.ReadAllTextAsync(outputPath);
        var doc = JsonDocument.Parse(json);
        var coverage = doc.RootElement.EnumerateArray().ToList();

        // Both files are in TiaCC.Core directory
        Assert.Single(coverage);
        var dir = coverage[0];
        Assert.Equal("TiaCC.Core", dir.GetProperty("directory").GetString());
        Assert.Equal(2, dir.GetProperty("fileCount").GetInt32());
    }

    #endregion

    #region Edge Cases

    [Fact]
    public async Task ExportAllAsync_WithEmptyDatabase_CreatesEmptyFiles()
    {
        using var db = new DatabaseService(_dbPath);
        await db.InitializeAsync();
        var exportService = new ExportService(db);

        await exportService.ExportAllAsync(_outputDir);

        // Verify all files exist
        Assert.True(File.Exists(Path.Combine(_outputDir, "stats.json")));

        // Verify stats show zeros
        var statsJson = await File.ReadAllTextAsync(Path.Combine(_outputDir, "stats.json"));
        var doc = JsonDocument.Parse(statsJson);
        Assert.Equal(0, doc.RootElement.GetProperty("sourceFileCount").GetInt32());
    }

    [Fact]
    public async Task ExportAllAsync_ValidJsonFormat()
    {
        using var db = await CreateDatabaseWithDataAsync();
        var exportService = new ExportService(db);

        await exportService.ExportAllAsync(_outputDir);

        // Verify all files are valid JSON
        foreach (var file in Directory.GetFiles(_outputDir, "*.json"))
        {
            var json = await File.ReadAllTextAsync(file);
            var exception = Record.Exception(() => JsonDocument.Parse(json));
            Assert.Null(exception);
        }
    }

    #endregion
}
