using Microsoft.EntityFrameworkCore;
using TiaCC.Core.Models;

namespace TiaCC.Core.Data;

/// <summary>
/// Entity Framework Core database context for TiaCC
/// </summary>
public class TiaCCDbContext : DbContext
{
    public DbSet<SourceFile> SourceFiles => Set<SourceFile>();
    public DbSet<TestScript> TestScripts => Set<TestScript>();
    public DbSet<CoverageMap> CoverageMaps => Set<CoverageMap>();
    public DbSet<Symbol> Symbols => Set<Symbol>();
    public DbSet<SymbolCoverage> SymbolCoverages => Set<SymbolCoverage>();

    private readonly string _dbPath;

    public TiaCCDbContext(string dbPath)
    {
        _dbPath = dbPath;
    }

    public TiaCCDbContext(DbContextOptions<TiaCCDbContext> options) : base(options)
    {
        _dbPath = "";
    }

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        if (!optionsBuilder.IsConfigured && !string.IsNullOrEmpty(_dbPath))
        {
            optionsBuilder.UseSqlite($"Data Source={_dbPath}");
        }
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // SourceFile
        modelBuilder.Entity<SourceFile>(entity =>
        {
            entity.ToTable("source_files");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.FilePath).HasColumnName("file_path").IsRequired();
            entity.Property(e => e.FileHash).HasColumnName("file_hash");
            entity.Property(e => e.LastUpdated).HasColumnName("last_updated");
            entity.HasIndex(e => e.FilePath).IsUnique();
        });

        // TestScript
        modelBuilder.Entity<TestScript>(entity =>
        {
            entity.ToTable("test_scripts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.ScriptPath).HasColumnName("script_path").IsRequired();
            entity.Property(e => e.LastRun).HasColumnName("last_run");
            entity.Property(e => e.AvgDurationMs).HasColumnName("avg_duration_ms");
            entity.HasIndex(e => e.ScriptPath).IsUnique();
        });

        // CoverageMap
        modelBuilder.Entity<CoverageMap>(entity =>
        {
            entity.ToTable("coverage_map");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.SourceFileId).HasColumnName("source_file_id");
            entity.Property(e => e.TestScriptId).HasColumnName("test_script_id");
            entity.Property(e => e.LineCoveragePct).HasColumnName("line_coverage_pct");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");

            entity.HasOne(e => e.SourceFile)
                  .WithMany(s => s.CoverageMaps)
                  .HasForeignKey(e => e.SourceFileId);

            entity.HasOne(e => e.TestScript)
                  .WithMany(t => t.CoverageMaps)
                  .HasForeignKey(e => e.TestScriptId);

            entity.HasIndex(e => new { e.SourceFileId, e.TestScriptId }).IsUnique();
        });

        // Symbol
        modelBuilder.Entity<Symbol>(entity =>
        {
            entity.ToTable("symbols");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.SourceFileId).HasColumnName("source_file_id");
            entity.Property(e => e.SymbolName).HasColumnName("symbol_name").IsRequired();
            entity.Property(e => e.SymbolType).HasColumnName("symbol_type").IsRequired();
            entity.Property(e => e.StartLine).HasColumnName("start_line");
            entity.Property(e => e.EndLine).HasColumnName("end_line");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");

            entity.HasOne(e => e.SourceFile)
                  .WithMany(s => s.Symbols)
                  .HasForeignKey(e => e.SourceFileId);

            entity.HasIndex(e => new { e.SourceFileId, e.SymbolName, e.StartLine }).IsUnique();
        });

        // SymbolCoverage
        modelBuilder.Entity<SymbolCoverage>(entity =>
        {
            entity.ToTable("symbol_coverage");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.SymbolId).HasColumnName("symbol_id");
            entity.Property(e => e.TestScriptId).HasColumnName("test_script_id");
            entity.Property(e => e.CoveragePct).HasColumnName("coverage_pct");
            entity.Property(e => e.CreatedAt).HasColumnName("created_at");

            entity.HasOne(e => e.Symbol)
                  .WithMany(s => s.SymbolCoverages)
                  .HasForeignKey(e => e.SymbolId);

            entity.HasOne(e => e.TestScript)
                  .WithMany(t => t.SymbolCoverages)
                  .HasForeignKey(e => e.TestScriptId);

            entity.HasIndex(e => new { e.SymbolId, e.TestScriptId }).IsUnique();
        });
    }
}
