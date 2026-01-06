namespace TiaCC.Core.Models;

/// <summary>
/// Represents a test script/executable
/// </summary>
public class TestScript
{
    public int Id { get; set; }
    public required string ScriptPath { get; set; }
    public DateTime? LastRun { get; set; }
    public double? AvgDurationMs { get; set; }

    // Navigation properties
    public ICollection<CoverageMap> CoverageMaps { get; set; } = [];
    public ICollection<SymbolCoverage> SymbolCoverages { get; set; } = [];
}
