using Microsoft.EntityFrameworkCore;
using TiaCC.Core.Data;
using TiaCC.Core.Models;

namespace TiaCC.Core.Services;

/// <summary>
/// Service for database operations
/// </summary>
public class DatabaseService : IDisposable
{
    private readonly TiaCCDbContext _context;
    private bool _disposed;

    public DatabaseService(string dbPath)
    {
        _context = new TiaCCDbContext(dbPath);
    }

    /// <summary>
    /// Initialize the database schema
    /// </summary>
    public async Task InitializeAsync()
    {
        await _context.Database.EnsureCreatedAsync();
    }

    /// <summary>
    /// Check if database exists
    /// </summary>
    public async Task<bool> ExistsAsync()
    {
        return await _context.Database.CanConnectAsync();
    }

    #region SourceFile Operations

    public async Task<SourceFile?> GetSourceFileAsync(string filePath)
    {
        return await _context.SourceFiles
            .FirstOrDefaultAsync(s => s.FilePath == filePath);
    }

    public async Task<SourceFile> GetOrCreateSourceFileAsync(string filePath)
    {
        var existing = await GetSourceFileAsync(filePath);
        if (existing != null) return existing;

        var sourceFile = new SourceFile { FilePath = filePath };
        _context.SourceFiles.Add(sourceFile);
        await _context.SaveChangesAsync();
        return sourceFile;
    }

    public async Task<List<SourceFile>> GetAllSourceFilesAsync()
    {
        return await _context.SourceFiles.ToListAsync();
    }

    #endregion

    #region TestScript Operations

    public async Task<TestScript?> GetTestScriptAsync(string scriptPath)
    {
        return await _context.TestScripts
            .FirstOrDefaultAsync(t => t.ScriptPath == scriptPath);
    }

    public async Task<TestScript> GetOrCreateTestScriptAsync(string scriptPath)
    {
        var existing = await GetTestScriptAsync(scriptPath);
        if (existing != null) return existing;

        var testScript = new TestScript { ScriptPath = scriptPath };
        _context.TestScripts.Add(testScript);
        await _context.SaveChangesAsync();
        return testScript;
    }

    public async Task<List<TestScript>> GetAllTestScriptsAsync()
    {
        return await _context.TestScripts.ToListAsync();
    }

    #endregion

    #region CoverageMap Operations

    public async Task UpsertCoverageMapAsync(int sourceFileId, int testScriptId, double coverage)
    {
        var existing = await _context.CoverageMaps
            .FirstOrDefaultAsync(c => c.SourceFileId == sourceFileId && c.TestScriptId == testScriptId);

        if (existing != null)
        {
            existing.LineCoveragePct = coverage;
            existing.CreatedAt = DateTime.UtcNow;
        }
        else
        {
            _context.CoverageMaps.Add(new CoverageMap
            {
                SourceFileId = sourceFileId,
                TestScriptId = testScriptId,
                LineCoveragePct = coverage
            });
        }

        await _context.SaveChangesAsync();
    }

    public async Task<List<CoverageMap>> GetAllMappingsAsync()
    {
        return await _context.CoverageMaps
            .Include(c => c.SourceFile)
            .Include(c => c.TestScript)
            .ToListAsync();
    }

    public async Task<List<TestScript>> GetTestsForSourceFileAsync(string filePath)
    {
        return await _context.CoverageMaps
            .Where(c => c.SourceFile.FilePath == filePath)
            .Select(c => c.TestScript)
            .Distinct()
            .ToListAsync();
    }

    #endregion

    #region Symbol Operations

    public async Task<Symbol> GetOrCreateSymbolAsync(int sourceFileId, string symbolName, string symbolType, int startLine, int endLine)
    {
        var existing = await _context.Symbols
            .FirstOrDefaultAsync(s => s.SourceFileId == sourceFileId && s.SymbolName == symbolName && s.StartLine == startLine);

        if (existing != null)
        {
            existing.EndLine = endLine;
            await _context.SaveChangesAsync();
            return existing;
        }

        var symbol = new Symbol
        {
            SourceFileId = sourceFileId,
            SymbolName = symbolName,
            SymbolType = symbolType,
            StartLine = startLine,
            EndLine = endLine
        };
        _context.Symbols.Add(symbol);
        await _context.SaveChangesAsync();
        return symbol;
    }

    public async Task<List<Symbol>> GetAllSymbolsAsync()
    {
        return await _context.Symbols
            .Include(s => s.SourceFile)
            .Include(s => s.SymbolCoverages)
                .ThenInclude(sc => sc.TestScript)
            .ToListAsync();
    }

    #endregion

    #region SymbolCoverage Operations

    public async Task UpsertSymbolCoverageAsync(int symbolId, int testScriptId, double coverage)
    {
        var existing = await _context.SymbolCoverages
            .FirstOrDefaultAsync(sc => sc.SymbolId == symbolId && sc.TestScriptId == testScriptId);

        if (existing != null)
        {
            existing.CoveragePct = coverage;
            existing.CreatedAt = DateTime.UtcNow;
        }
        else
        {
            _context.SymbolCoverages.Add(new SymbolCoverage
            {
                SymbolId = symbolId,
                TestScriptId = testScriptId,
                CoveragePct = coverage
            });
        }

        await _context.SaveChangesAsync();
    }

    #endregion

    #region Statistics

    public async Task<DatabaseStats> GetStatsAsync()
    {
        var sourceFileCount = await _context.SourceFiles.CountAsync();
        var testScriptCount = await _context.TestScripts.CountAsync();
        var mappingCount = await _context.CoverageMaps.CountAsync();
        var symbolCount = await _context.Symbols.CountAsync();

        var avgCoverage = await _context.CoverageMaps
            .AverageAsync(c => (double?)c.LineCoveragePct) ?? 0;

        return new DatabaseStats
        {
            SourceFileCount = sourceFileCount,
            TestScriptCount = testScriptCount,
            MappingCount = mappingCount,
            SymbolCount = symbolCount,
            AverageCoverage = avgCoverage
        };
    }

    public async Task<List<DirectoryCoverage>> GetCoverageByDirectoryAsync()
    {
        var mappings = await _context.CoverageMaps
            .Include(c => c.SourceFile)
            .Include(c => c.TestScript)
            .ToListAsync();

        var grouped = mappings
            .GroupBy(m => GetDirectory(m.SourceFile.FilePath))
            .Select(g => new DirectoryCoverage
            {
                Directory = g.Key,
                FileCount = g.Select(m => m.SourceFileId).Distinct().Count(),
                TestCount = g.Select(m => m.TestScriptId).Distinct().Count(),
                AvgCoverage = g.Average(m => m.LineCoveragePct)
            })
            .OrderByDescending(d => d.AvgCoverage)
            .ToList();

        return grouped;
    }

    private static string GetDirectory(string filePath)
    {
        var parts = filePath.Split('/', '\\');
        return parts.Length > 1 ? parts[0] : ".";
    }

    #endregion

    public void Dispose()
    {
        if (!_disposed)
        {
            _context.Dispose();
            _disposed = true;
        }
        GC.SuppressFinalize(this);
    }
}

public record DatabaseStats
{
    public int SourceFileCount { get; init; }
    public int TestScriptCount { get; init; }
    public int MappingCount { get; init; }
    public int SymbolCount { get; init; }
    public double AverageCoverage { get; init; }
}

public record DirectoryCoverage
{
    public required string Directory { get; init; }
    public int FileCount { get; init; }
    public int TestCount { get; init; }
    public double AvgCoverage { get; init; }
}
