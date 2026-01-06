using Microsoft.Data.Sqlite;
using TiaCC.Core.Services;
using Xunit;

namespace TiaCC.Core.Tests;

public class DatabaseServiceTests : IDisposable
{
    private readonly string _testDir;
    private readonly string _dbPath;

    public DatabaseServiceTests()
    {
        _testDir = Path.Combine(Path.GetTempPath(), $"tiacc_db_test_{Guid.NewGuid():N}");
        Directory.CreateDirectory(_testDir);
        _dbPath = Path.Combine(_testDir, "test.db");
    }

    public void Dispose()
    {
        // Clear connection pool to release database file handles
        SqliteConnection.ClearAllPools();
        
        // Retry deletion with a short delay if the file is still locked
        for (int i = 0; i < 3; i++)
        {
            try
            {
                if (Directory.Exists(_testDir))
                    Directory.Delete(_testDir, true);
                break;
            }
            catch (IOException) when (i < 2)
            {
                Thread.Sleep(100);
            }
        }
        GC.SuppressFinalize(this);
    }

    #region Initialization Tests

    [Fact]
    public async Task InitializeAsync_CreatesDatabase()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();

        Assert.True(File.Exists(_dbPath));
    }

    [Fact]
    public async Task ExistsAsync_AfterInitialization_ReturnsTrue()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();

        var exists = await service.ExistsAsync();

        Assert.True(exists);
    }

    #endregion

    #region SourceFile Tests

    [Fact]
    public async Task GetOrCreateSourceFileAsync_NewFile_CreatesRecord()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();

        var file = await service.GetOrCreateSourceFileAsync("src/calculator.cpp");

        Assert.NotNull(file);
        Assert.Equal("src/calculator.cpp", file.FilePath);
        Assert.True(file.Id > 0);
    }

    [Fact]
    public async Task GetOrCreateSourceFileAsync_ExistingFile_ReturnsSameRecord()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();

        var file1 = await service.GetOrCreateSourceFileAsync("src/calculator.cpp");
        var file2 = await service.GetOrCreateSourceFileAsync("src/calculator.cpp");

        Assert.Equal(file1.Id, file2.Id);
    }

    [Fact]
    public async Task GetAllSourceFilesAsync_ReturnsAllFiles()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();
        await service.GetOrCreateSourceFileAsync("src/a.cpp");
        await service.GetOrCreateSourceFileAsync("src/b.cpp");
        await service.GetOrCreateSourceFileAsync("src/c.cpp");

        var files = await service.GetAllSourceFilesAsync();

        Assert.Equal(3, files.Count);
    }

    #endregion

    #region TestScript Tests

    [Fact]
    public async Task GetOrCreateTestScriptAsync_NewScript_CreatesRecord()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();

        var script = await service.GetOrCreateTestScriptAsync("test_calculator");

        Assert.NotNull(script);
        Assert.Equal("test_calculator", script.ScriptPath);
        Assert.True(script.Id > 0);
    }

    [Fact]
    public async Task GetOrCreateTestScriptAsync_ExistingScript_ReturnsSameRecord()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();

        var script1 = await service.GetOrCreateTestScriptAsync("test_calculator");
        var script2 = await service.GetOrCreateTestScriptAsync("test_calculator");

        Assert.Equal(script1.Id, script2.Id);
    }

    #endregion

    #region CoverageMap Tests

    [Fact]
    public async Task UpsertCoverageMapAsync_NewMapping_CreatesRecord()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();
        var file = await service.GetOrCreateSourceFileAsync("src/calculator.cpp");
        var test = await service.GetOrCreateTestScriptAsync("test_calculator");

        await service.UpsertCoverageMapAsync(file.Id, test.Id, 85.5);

        var mappings = await service.GetAllMappingsAsync();
        Assert.Single(mappings);
        Assert.Equal(85.5, mappings[0].LineCoveragePct);
    }

    [Fact]
    public async Task UpsertCoverageMapAsync_ExistingMapping_UpdatesRecord()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();
        var file = await service.GetOrCreateSourceFileAsync("src/calculator.cpp");
        var test = await service.GetOrCreateTestScriptAsync("test_calculator");

        await service.UpsertCoverageMapAsync(file.Id, test.Id, 85.5);
        await service.UpsertCoverageMapAsync(file.Id, test.Id, 90.0);

        var mappings = await service.GetAllMappingsAsync();
        Assert.Single(mappings);
        Assert.Equal(90.0, mappings[0].LineCoveragePct);
    }

    [Fact]
    public async Task GetTestsForSourceFileAsync_ReturnsMatchingTests()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();
        var file = await service.GetOrCreateSourceFileAsync("src/calculator.cpp");
        var test1 = await service.GetOrCreateTestScriptAsync("test_add");
        var test2 = await service.GetOrCreateTestScriptAsync("test_subtract");
        await service.UpsertCoverageMapAsync(file.Id, test1.Id, 80.0);
        await service.UpsertCoverageMapAsync(file.Id, test2.Id, 75.0);

        var tests = await service.GetTestsForSourceFileAsync("src/calculator.cpp");

        Assert.Equal(2, tests.Count);
        Assert.Contains(tests, t => t.ScriptPath == "test_add");
        Assert.Contains(tests, t => t.ScriptPath == "test_subtract");
    }

    #endregion

    #region Symbol Tests

    [Fact]
    public async Task GetOrCreateSymbolAsync_NewSymbol_CreatesRecord()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();
        var file = await service.GetOrCreateSourceFileAsync("src/calculator.cpp");

        var symbol = await service.GetOrCreateSymbolAsync(file.Id, "add", "function", 10, 20);

        Assert.NotNull(symbol);
        Assert.Equal("add", symbol.SymbolName);
        Assert.Equal("function", symbol.SymbolType);
        Assert.Equal(10, symbol.StartLine);
        Assert.Equal(20, symbol.EndLine);
    }

    [Fact]
    public async Task GetOrCreateSymbolAsync_ExistingSymbol_UpdatesEndLine()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();
        var file = await service.GetOrCreateSourceFileAsync("src/calculator.cpp");

        var symbol1 = await service.GetOrCreateSymbolAsync(file.Id, "add", "function", 10, 20);
        var symbol2 = await service.GetOrCreateSymbolAsync(file.Id, "add", "function", 10, 25);

        Assert.Equal(symbol1.Id, symbol2.Id);
        Assert.Equal(25, symbol2.EndLine);
    }

    #endregion

    #region SymbolCoverage Tests

    [Fact]
    public async Task UpsertSymbolCoverageAsync_CreatesOrUpdates()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();
        var file = await service.GetOrCreateSourceFileAsync("src/calculator.cpp");
        var symbol = await service.GetOrCreateSymbolAsync(file.Id, "add", "function", 10, 20);
        var test = await service.GetOrCreateTestScriptAsync("test_add");

        await service.UpsertSymbolCoverageAsync(symbol.Id, test.Id, 100.0);

        var symbols = await service.GetAllSymbolsAsync();
        Assert.Single(symbols);
        Assert.Single(symbols[0].SymbolCoverages);
        Assert.Equal(100.0, symbols[0].SymbolCoverages.First().CoveragePct);
    }

    #endregion

    #region Statistics Tests

    [Fact]
    public async Task GetStatsAsync_ReturnsCorrectStats()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();
        var file1 = await service.GetOrCreateSourceFileAsync("src/a.cpp");
        var file2 = await service.GetOrCreateSourceFileAsync("src/b.cpp");
        var test = await service.GetOrCreateTestScriptAsync("test_all");
        await service.UpsertCoverageMapAsync(file1.Id, test.Id, 80.0);
        await service.UpsertCoverageMapAsync(file2.Id, test.Id, 60.0);

        var stats = await service.GetStatsAsync();

        Assert.Equal(2, stats.SourceFileCount);
        Assert.Equal(1, stats.TestScriptCount);
        Assert.Equal(2, stats.MappingCount);
        Assert.Equal(70.0, stats.AverageCoverage);
    }

    [Fact]
    public async Task GetCoverageByDirectoryAsync_GroupsCorrectly()
    {
        using var service = new DatabaseService(_dbPath);
        await service.InitializeAsync();
        var file1 = await service.GetOrCreateSourceFileAsync("src/core/a.cpp");
        var file2 = await service.GetOrCreateSourceFileAsync("src/core/b.cpp");
        var file3 = await service.GetOrCreateSourceFileAsync("tests/test.cpp");
        var test = await service.GetOrCreateTestScriptAsync("test_all");
        await service.UpsertCoverageMapAsync(file1.Id, test.Id, 80.0);
        await service.UpsertCoverageMapAsync(file2.Id, test.Id, 90.0);
        await service.UpsertCoverageMapAsync(file3.Id, test.Id, 100.0);

        var coverage = await service.GetCoverageByDirectoryAsync();

        Assert.Equal(2, coverage.Count);
        var srcDir = coverage.First(c => c.Directory == "src");
        Assert.Equal(2, srcDir.FileCount);
        Assert.Equal(85.0, srcDir.AvgCoverage);
    }

    #endregion
}
