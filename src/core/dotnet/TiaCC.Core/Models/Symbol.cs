namespace TiaCC.Core.Models;

/// <summary>
/// Represents a code symbol (function, method, class, etc.)
/// </summary>
public class Symbol
{
    public int Id { get; set; }
    public int SourceFileId { get; set; }
    public required string SymbolName { get; set; }
    public required string SymbolType { get; set; } // function, class, method, etc.
    public int StartLine { get; set; }
    public int EndLine { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public SourceFile SourceFile { get; set; } = null!;
    public ICollection<SymbolCoverage> SymbolCoverages { get; set; } = [];
}
