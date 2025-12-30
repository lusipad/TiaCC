using System.Text.Json.Serialization;

namespace TiaCC.Dashboard.Models;

public class DashboardData
{
    [JsonPropertyName("generatedAt")]
    public DateTime GeneratedAt { get; set; }

    [JsonPropertyName("sourceFiles")]
    public List<SourceFileInfo> SourceFiles { get; set; } = [];

    [JsonPropertyName("testScripts")]
    public List<TestScriptInfo> TestScripts { get; set; } = [];

    [JsonPropertyName("coverageMap")]
    public List<CoverageMapEntry> CoverageMap { get; set; } = [];

    [JsonPropertyName("symbols")]
    public List<SymbolInfo> Symbols { get; set; } = [];

    [JsonPropertyName("symbolCoverage")]
    public List<SymbolCoverageEntry> SymbolCoverage { get; set; } = [];
}

public class SourceFileInfo
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("path")]
    public string Path { get; set; } = "";

    [JsonPropertyName("hash")]
    public string? Hash { get; set; }

    [JsonPropertyName("lastScanned")]
    public DateTime? LastScanned { get; set; }
}

public class TestScriptInfo
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("lastRun")]
    public DateTime? LastRun { get; set; }
}

public class CoverageMapEntry
{
    [JsonPropertyName("sourceFileId")]
    public int SourceFileId { get; set; }

    [JsonPropertyName("testScriptId")]
    public int TestScriptId { get; set; }

    [JsonPropertyName("coveragePercentage")]
    public double CoveragePercentage { get; set; }

    [JsonPropertyName("hitCount")]
    public int HitCount { get; set; }
}

public class SymbolInfo
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("sourceFileId")]
    public int SourceFileId { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "";

    [JsonPropertyName("startLine")]
    public int StartLine { get; set; }

    [JsonPropertyName("endLine")]
    public int EndLine { get; set; }
}

public class SymbolCoverageEntry
{
    [JsonPropertyName("symbolId")]
    public int SymbolId { get; set; }

    [JsonPropertyName("testScriptId")]
    public int TestScriptId { get; set; }

    [JsonPropertyName("coveragePercentage")]
    public double CoveragePercentage { get; set; }

    [JsonPropertyName("hitCount")]
    public int HitCount { get; set; }
}

// View models for UI
public class ModuleCoverage
{
    public string ModuleName { get; set; } = "";
    public int FileCount { get; set; }
    public int CoveredFiles { get; set; }
    public double AverageCoverage { get; set; }
    public List<FileCoverage> Files { get; set; } = [];
}

public class FileCoverage
{
    public string FileName { get; set; } = "";
    public string FullPath { get; set; } = "";
    public double Coverage { get; set; }
    public int TestCount { get; set; }
    public List<string> Tests { get; set; } = [];
}

public class TreemapNode
{
    public string Name { get; set; } = "";
    public string FullPath { get; set; } = "";
    public double Value { get; set; }
    public double Coverage { get; set; }
    public bool IsDirectory { get; set; }
    public List<TreemapNode> Children { get; set; } = [];
}

public class FileTreeNode
{
    public string Name { get; set; } = "";
    public string FullPath { get; set; } = "";
    public bool IsDirectory { get; set; }
    public double? Coverage { get; set; }
    public bool IsExpanded { get; set; }
    public List<FileTreeNode> Children { get; set; } = [];
}
