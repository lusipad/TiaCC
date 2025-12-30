using System.Text.Json;
using System.Xml.Linq;

namespace TiaCC.Core.Services;

/// <summary>
/// Parses coverage data from various formats (LLVM JSON, Cobertura XML, LCOV)
/// </summary>
public class CoverageParser
{
    /// <summary>
    /// Parse LLVM coverage JSON export format
    /// </summary>
    public static CoverageData ParseLlvmJson(string jsonPath)
    {
        var json = File.ReadAllText(jsonPath);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var result = new CoverageData();

        // LLVM coverage JSON structure: { data: [{ files: [...], functions: [...] }] }
        if (root.TryGetProperty("data", out var dataArray))
        {
            foreach (var data in dataArray.EnumerateArray())
            {
                // Parse files
                if (data.TryGetProperty("files", out var files))
                {
                    foreach (var file in files.EnumerateArray())
                    {
                        var filename = file.GetProperty("filename").GetString() ?? "";
                        var summary = file.GetProperty("summary");
                        var lines = summary.GetProperty("lines");
                        var covered = lines.GetProperty("covered").GetInt32();
                        var count = lines.GetProperty("count").GetInt32();
                        var pct = count > 0 ? (double)covered / count * 100 : 0;

                        result.Files[filename] = new FileCoverage
                        {
                            FilePath = filename,
                            CoveredLines = covered,
                            TotalLines = count,
                            CoveragePercent = pct
                        };
                    }
                }

                // Parse functions
                if (data.TryGetProperty("functions", out var functions))
                {
                    foreach (var func in functions.EnumerateArray())
                    {
                        var name = func.GetProperty("name").GetString() ?? "";
                        var filenames = func.GetProperty("filenames").EnumerateArray()
                            .Select(f => f.GetString() ?? "").ToList();

                        if (filenames.Count == 0) continue;

                        var regions = func.GetProperty("regions").EnumerateArray().ToList();
                        if (regions.Count == 0) continue;

                        var firstRegion = regions[0];
                        var startLine = firstRegion[0].GetInt32();
                        var endLine = regions[^1][2].GetInt32();

                        var count = func.GetProperty("count").GetInt32();

                        result.Functions.Add(new FunctionCoverage
                        {
                            Name = name,
                            FilePath = filenames[0],
                            StartLine = startLine,
                            EndLine = endLine,
                            ExecutionCount = count,
                            IsCovered = count > 0
                        });
                    }
                }
            }
        }

        return result;
    }

    /// <summary>
    /// Parse Cobertura XML format
    /// </summary>
    public static CoverageData ParseCoberturaXml(string xmlPath)
    {
        var doc = XDocument.Load(xmlPath);
        var result = new CoverageData();

        var packages = doc.Descendants("package");
        foreach (var package in packages)
        {
            var classes = package.Descendants("class");
            foreach (var cls in classes)
            {
                var filename = cls.Attribute("filename")?.Value ?? "";
                var lineRate = double.Parse(cls.Attribute("line-rate")?.Value ?? "0");

                var lines = cls.Descendants("line").ToList();
                var covered = lines.Count(l => int.Parse(l.Attribute("hits")?.Value ?? "0") > 0);

                result.Files[filename] = new FileCoverage
                {
                    FilePath = filename,
                    CoveredLines = covered,
                    TotalLines = lines.Count,
                    CoveragePercent = lineRate * 100
                };

                // Parse methods
                var methods = cls.Descendants("method");
                foreach (var method in methods)
                {
                    var name = method.Attribute("name")?.Value ?? "";
                    var methodLines = method.Descendants("line").ToList();
                    if (methodLines.Count == 0) continue;

                    var startLine = methodLines.Min(l => int.Parse(l.Attribute("number")?.Value ?? "0"));
                    var endLine = methodLines.Max(l => int.Parse(l.Attribute("number")?.Value ?? "0"));
                    var hits = methodLines.Sum(l => int.Parse(l.Attribute("hits")?.Value ?? "0"));

                    result.Functions.Add(new FunctionCoverage
                    {
                        Name = name,
                        FilePath = filename,
                        StartLine = startLine,
                        EndLine = endLine,
                        ExecutionCount = hits,
                        IsCovered = hits > 0
                    });
                }
            }
        }

        return result;
    }

    /// <summary>
    /// Parse LCOV format
    /// </summary>
    public static CoverageData ParseLcov(string lcovPath)
    {
        var result = new CoverageData();
        var lines = File.ReadAllLines(lcovPath);

        string? currentFile = null;
        int coveredLines = 0;
        int totalLines = 0;
        string? currentFunction = null;
        int functionStartLine = 0;

        foreach (var line in lines)
        {
            if (line.StartsWith("SF:"))
            {
                currentFile = line[3..];
                coveredLines = 0;
                totalLines = 0;
            }
            else if (line.StartsWith("FN:") && currentFile != null)
            {
                var parts = line[3..].Split(',');
                if (parts.Length >= 2)
                {
                    functionStartLine = int.Parse(parts[0]);
                    currentFunction = parts[1];
                }
            }
            else if (line.StartsWith("FNDA:") && currentFile != null && currentFunction != null)
            {
                var parts = line[5..].Split(',');
                if (parts.Length >= 2)
                {
                    var hits = int.Parse(parts[0]);
                    result.Functions.Add(new FunctionCoverage
                    {
                        Name = currentFunction,
                        FilePath = currentFile,
                        StartLine = functionStartLine,
                        EndLine = functionStartLine, // LCOV doesn't provide end line
                        ExecutionCount = hits,
                        IsCovered = hits > 0
                    });
                }
                currentFunction = null;
            }
            else if (line.StartsWith("DA:"))
            {
                var parts = line[3..].Split(',');
                if (parts.Length >= 2)
                {
                    totalLines++;
                    if (int.Parse(parts[1]) > 0) coveredLines++;
                }
            }
            else if (line == "end_of_record" && currentFile != null)
            {
                var pct = totalLines > 0 ? (double)coveredLines / totalLines * 100 : 0;
                result.Files[currentFile] = new FileCoverage
                {
                    FilePath = currentFile,
                    CoveredLines = coveredLines,
                    TotalLines = totalLines,
                    CoveragePercent = pct
                };
                currentFile = null;
            }
        }

        return result;
    }

    /// <summary>
    /// Auto-detect format and parse
    /// </summary>
    public static CoverageData Parse(string filePath)
    {
        var extension = Path.GetExtension(filePath).ToLowerInvariant();

        return extension switch
        {
            ".json" => ParseLlvmJson(filePath),
            ".xml" => ParseCoberturaXml(filePath),
            ".info" or ".lcov" => ParseLcov(filePath),
            _ => throw new NotSupportedException($"Unsupported coverage format: {extension}")
        };
    }
}

public class CoverageData
{
    public Dictionary<string, FileCoverage> Files { get; } = new();
    public List<FunctionCoverage> Functions { get; } = [];
}

public record FileCoverage
{
    public required string FilePath { get; init; }
    public int CoveredLines { get; init; }
    public int TotalLines { get; init; }
    public double CoveragePercent { get; init; }
}

public record FunctionCoverage
{
    public required string Name { get; init; }
    public required string FilePath { get; init; }
    public int StartLine { get; init; }
    public int EndLine { get; init; }
    public int ExecutionCount { get; init; }
    public bool IsCovered { get; init; }
}
