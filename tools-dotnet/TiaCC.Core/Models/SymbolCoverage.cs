namespace TiaCC.Core.Models;

/// <summary>
/// Maps symbols to test scripts with coverage data
/// </summary>
public class SymbolCoverage
{
    public int Id { get; set; }
    public int SymbolId { get; set; }
    public int TestScriptId { get; set; }
    public double CoveragePct { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Symbol Symbol { get; set; } = null!;
    public TestScript TestScript { get; set; } = null!;
}
