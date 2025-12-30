namespace TiaCC.Core.Models;

/// <summary>
/// Maps source files to test scripts with coverage data
/// </summary>
public class CoverageMap
{
    public int Id { get; set; }
    public int SourceFileId { get; set; }
    public int TestScriptId { get; set; }
    public double LineCoveragePct { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public SourceFile SourceFile { get; set; } = null!;
    public TestScript TestScript { get; set; } = null!;
}
