using Microsoft.EntityFrameworkCore;
using TiaCC.Core.Data;
using TiaCC.Core.Models;

namespace TiaCC.Core.Services;

/// <summary>
/// Service for database operations
/// </summary>
public class DatabaseService : IDisposable, IAsyncDisposable
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
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await _context.Database.EnsureCreatedAsync(cancellationToken);
    }

    /// <summary>
    /// Check if database exists
    /// </summary>
    public async Task<bool> ExistsAsync(CancellationToken cancellationToken = default)
    {
        return await _context.Database.CanConnectAsync(cancellationToken);
    }

    #region SourceFile Operations

    public async Task<SourceFile?> GetSourceFileAsync(string filePath, CancellationToken cancellationToken = default)
    {
        return await _context.SourceFiles
            .FirstOrDefaultAsync(s => s.FilePath == filePath, cancellationToken);
    }

    public async Task<SourceFile> GetOrCreateSourceFileAsync(string filePath, CancellationToken cancellationToken = default)
    {
        var existing = await GetSourceFileAsync(filePath, cancellationToken);
        if (existing != null) return existing;

        var sourceFile = new SourceFile { FilePath = filePath };
        _context.SourceFiles.Add(sourceFile);
        await _context.SaveChangesAsync(cancellationToken);
        return sourceFile;
    }

    public async Task<List<SourceFile>> GetAllSourceFilesAsync(CancellationToken cancellationToken = default)
    {
        return await _context.SourceFiles.ToListAsync(cancellationToken);
    }

    #endregion

    #region TestScript Operations

    public async Task<TestScript?> GetTestScriptAsync(string scriptPath, CancellationToken cancellationToken = default)
    {
        return await _context.TestScripts
            .FirstOrDefaultAsync(t => t.ScriptPath == scriptPath, cancellationToken);
    }

    public async Task<TestScript> GetOrCreateTestScriptAsync(string scriptPath, CancellationToken cancellationToken = default)
    {
        var existing = await GetTestScriptAsync(scriptPath, cancellationToken);
        if (existing != null) return existing;

        var testScript = new TestScript { ScriptPath = scriptPath };
        _context.TestScripts.Add(testScript);
        await _context.SaveChangesAsync(cancellationToken);
        return testScript;
    }

    public async Task<List<TestScript>> GetAllTestScriptsAsync(CancellationToken cancellationToken = default)
    {
        return await _context.TestScripts.ToListAsync(cancellationToken);
    }

    #endregion

    #region CoverageMap Operations

    public async Task UpsertCoverageMapAsync(int sourceFileId, int testScriptId, double coverage, CancellationToken cancellationToken = default)
    {
        var existing = await _context.CoverageMaps
            .FirstOrDefaultAsync(c => c.SourceFileId == sourceFileId && c.TestScriptId == testScriptId, cancellationToken);

        if (existing != null)
        {
            existing.LineCoveragePct = coverage;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            _context.CoverageMaps.Add(new CoverageMap
            {
                SourceFileId = sourceFileId,
                TestScriptId = testScriptId,
                LineCoveragePct = coverage,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task<List<CoverageMap>> GetAllMappingsAsync(CancellationToken cancellationToken = default)
    {
        return await _context.CoverageMaps
            .Include(c => c.SourceFile)
            .Include(c => c.TestScript)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<TestScript>> GetTestsForSourceFileAsync(string filePath, CancellationToken cancellationToken = default)
    {
        return await _context.CoverageMaps
            .Where(c => c.SourceFile.FilePath == filePath)
            .Select(c => c.TestScript)
            .Distinct()
            .ToListAsync(cancellationToken);
    }

    #endregion

    #region Symbol Operations

    public async Task<Symbol> GetOrCreateSymbolAsync(int sourceFileId, string symbolName, string symbolType, int startLine, int endLine, CancellationToken cancellationToken = default)
    {
        var existing = await _context.Symbols
            .FirstOrDefaultAsync(s => s.SourceFileId == sourceFileId && s.SymbolName == symbolName && s.StartLine == startLine, cancellationToken);

        if (existing != null)
        {
            existing.EndLine = endLine;
            await _context.SaveChangesAsync(cancellationToken);
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
        await _context.SaveChangesAsync(cancellationToken);
        return symbol;
    }

    public async Task<List<Symbol>> GetAllSymbolsAsync(CancellationToken cancellationToken = default)
    {
        return await _context.Symbols
            .Include(s => s.SourceFile)
            .Include(s => s.SymbolCoverages)
                .ThenInclude(sc => sc.TestScript)
            .ToListAsync(cancellationToken);
    }

    #endregion

    #region SymbolCoverage Operations

    public async Task UpsertSymbolCoverageAsync(int symbolId, int testScriptId, double coverage, CancellationToken cancellationToken = default)
    {
        var existing = await _context.SymbolCoverages
            .FirstOrDefaultAsync(sc => sc.SymbolId == symbolId && sc.TestScriptId == testScriptId, cancellationToken);

        if (existing != null)
        {
            existing.CoveragePct = coverage;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            _context.SymbolCoverages.Add(new SymbolCoverage
            {
                SymbolId = symbolId,
                TestScriptId = testScriptId,
                CoveragePct = coverage,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _context.SaveChangesAsync(cancellationToken);
    }

    #endregion

    #region Statistics

    public async Task<DatabaseStats> GetStatsAsync(CancellationToken cancellationToken = default)
    {
        var sourceFileCount = await _context.SourceFiles.CountAsync(cancellationToken);
        var testScriptCount = await _context.TestScripts.CountAsync(cancellationToken);
        var mappingCount = await _context.CoverageMaps.CountAsync(cancellationToken);
        var symbolCount = await _context.Symbols.CountAsync(cancellationToken);

        var avgCoverage = await _context.CoverageMaps
            .AverageAsync(c => (double?)c.LineCoveragePct, cancellationToken) ?? 0;

        return new DatabaseStats
        {
            SourceFileCount = sourceFileCount,
            TestScriptCount = testScriptCount,
            MappingCount = mappingCount,
            SymbolCount = symbolCount,
            AverageCoverage = avgCoverage
        };
    }

    public async Task<List<DirectoryCoverage>> GetCoverageByDirectoryAsync(int depth = 1, CancellationToken cancellationToken = default)
    {
        var mappings = await _context.CoverageMaps
            .Include(c => c.SourceFile)
            .Include(c => c.TestScript)
            .ToListAsync(cancellationToken);

        var grouped = mappings
            .GroupBy(m => GetDirectory(m.SourceFile.FilePath, depth))
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

    private static string GetDirectory(string filePath, int depth = 1)
    {
        var parts = filePath.Split('/', '\\');
        if (parts.Length <= 1) return ".";

        var directoryParts = parts.Take(Math.Min(depth, parts.Length - 1));
        return string.Join("/", directoryParts);
    }

    #endregion

    public void Dispose()
    {
        Dispose(disposing: true);
        GC.SuppressFinalize(this);
    }

    public async ValueTask DisposeAsync()
    {
        await DisposeAsyncCore();
        Dispose(disposing: false);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool disposing)
    {
        if (!_disposed)
        {
            if (disposing)
            {
                _context.Dispose();
            }
            _disposed = true;
        }
    }

    protected virtual async ValueTask DisposeAsyncCore()
    {
        if (!_disposed)
        {
            await _context.DisposeAsync();
        }
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
