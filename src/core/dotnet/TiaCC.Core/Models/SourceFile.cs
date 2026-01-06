namespace TiaCC.Core.Models;

/// <summary>
/// Represents a source file tracked by TiaCC
/// </summary>
public class SourceFile
{
    public int Id { get; set; }
    public required string FilePath { get; set; }
    public string? FileHash { get; set; }
    public DateTime LastUpdated { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public ICollection<CoverageMap> CoverageMaps { get; set; } = [];
    public ICollection<Symbol> Symbols { get; set; } = [];
}
