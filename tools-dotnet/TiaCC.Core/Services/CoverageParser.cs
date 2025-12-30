using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace TiaCC.Core.Services;

/// <summary>
/// Parses coverage data from various formats
/// </summary>
public static class CoverageParser
{
    /// <summary>
    /// Auto-detect format and parse coverage file
    /// </summary>
    public static CoverageData Parse(string filePath, string? basePath = null)
    {
        var fileName = Path.GetFileName(filePath).ToLowerInvariant();
        var extension = Path.GetExtension(filePath).ToLowerInvariant();

        return (extension, fileName) switch
        {
            (".profraw", _) => ParseLlvmProfraw(filePath),
            (".json", _) when fileName.EndsWith(".cov.json") => ParseLlvmJson(filePath, basePath),
            (".json", _) when fileName.Contains(".coverage") => ParseCoverletJson(filePath, basePath),
            (".json", _) when fileName.Contains("istanbul") || fileName == "coverage-final.json" => ParseIstanbulJson(filePath, basePath),
            (".json", _) => ParseGenericJson(filePath, basePath),
            (".xml", _) when fileName.Contains("jacoco") => ParseJacocoXml(filePath, basePath),
            (".xml", _) when fileName.Contains("dotcover") => ParseDotCoverXml(filePath, basePath),
            (".xml", _) => ParseCoberturaXml(filePath, basePath), // Cobertura is common default for XML
            (".info", _) or (".lcov", _) => ParseLcov(filePath, basePath),
            (".out", _) when fileName.Contains("luacov") => ParseLuaCov(filePath, basePath),
            (".dcvr", _) => ParseDotCoverXml(filePath, basePath),
            _ => throw new NotSupportedException($"Unsupported coverage format: {extension}")
        };
    }

    #region LLVM Formats

    /// <summary>
    /// Parse LLVM .profraw format (requires llvm-profdata and llvm-cov tools)
    /// </summary>
    public static CoverageData ParseLlvmProfraw(string profrawPath, string? executable = null, string? llvmProfdata = null, string? llvmCov = null)
    {
        llvmProfdata ??= "llvm-profdata";
        llvmCov ??= "llvm-cov";

        var profdataPath = profrawPath.Replace(".profraw", ".profdata");

        // Convert profraw to profdata
        RunCommand(llvmProfdata, $"merge -sparse \"{profrawPath}\" -o \"{profdataPath}\"");

        if (string.IsNullOrEmpty(executable))
        {
            return new CoverageData();
        }

        // Export to JSON
        var jsonOutput = RunCommand(llvmCov, $"export \"{executable}\" -instr-profile=\"{profdataPath}\" -format=text");

        using var doc = JsonDocument.Parse(jsonOutput);
        return ParseLlvmJsonDocument(doc, null);
    }

    /// <summary>
    /// Parse LLVM JSON export format (.cov.json)
    /// </summary>
    public static CoverageData ParseLlvmJson(string jsonPath, string? basePath = null)
    {
        var json = File.ReadAllText(jsonPath);
        using var doc = JsonDocument.Parse(json);
        return ParseLlvmJsonDocument(doc, basePath);
    }

    private static CoverageData ParseLlvmJsonDocument(JsonDocument doc, string? basePath)
    {
        var result = new CoverageData();
        var root = doc.RootElement;

        if (!root.TryGetProperty("data", out var dataArray)) return result;

        foreach (var data in dataArray.EnumerateArray())
        {
            // Parse files
            if (data.TryGetProperty("files", out var files))
            {
                foreach (var file in files.EnumerateArray())
                {
                    var filename = NormalizePath(file.GetProperty("filename").GetString() ?? "", basePath);
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
                        .Select(f => NormalizePath(f.GetString() ?? "", basePath)).ToList();

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

        return result;
    }

    #endregion

    #region .NET Formats

    /// <summary>
    /// Parse Coverlet JSON format (.coverage.json)
    /// </summary>
    public static CoverageData ParseCoverletJson(string jsonPath, string? basePath = null)
    {
        var result = new CoverageData();
        var json = File.ReadAllText(jsonPath);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        foreach (var module in root.EnumerateObject())
        {
            foreach (var file in module.Value.EnumerateObject())
            {
                var filePath = NormalizePath(file.Name, basePath);
                int totalLines = 0, coveredLines = 0;

                foreach (var method in file.Value.EnumerateObject())
                {
                    if (!method.Value.TryGetProperty("Lines", out var lines)) continue;

                    int methodStart = int.MaxValue, methodEnd = 0;
                    int methodHits = 0;

                    foreach (var line in lines.EnumerateObject())
                    {
                        var lineNum = int.Parse(line.Name);
                        var hits = line.Value.GetInt32();

                        totalLines++;
                        if (hits > 0)
                        {
                            coveredLines++;
                            methodHits++;
                        }

                        methodStart = Math.Min(methodStart, lineNum);
                        methodEnd = Math.Max(methodEnd, lineNum);
                    }

                    if (methodHits > 0)
                    {
                        result.Functions.Add(new FunctionCoverage
                        {
                            Name = method.Name,
                            FilePath = filePath,
                            StartLine = methodStart,
                            EndLine = methodEnd,
                            ExecutionCount = methodHits,
                            IsCovered = true
                        });
                    }
                }

                if (coveredLines > 0)
                {
                    result.Files[filePath] = new FileCoverage
                    {
                        FilePath = filePath,
                        CoveredLines = coveredLines,
                        TotalLines = totalLines,
                        CoveragePercent = totalLines > 0 ? (double)coveredLines / totalLines * 100 : 0
                    };
                }
            }
        }

        return result;
    }

    /// <summary>
    /// Parse JetBrains dotCover XML format
    /// </summary>
    public static CoverageData ParseDotCoverXml(string xmlPath, string? basePath = null)
    {
        var result = new CoverageData();
        var doc = XDocument.Load(xmlPath);
        var root = doc.Root;
        if (root?.Name.LocalName != "Root") return result;

        var fileStats = new Dictionary<string, (int Total, int Covered)>();

        void ProcessAssembly(XElement assembly)
        {
            foreach (var ns in assembly.Elements("Namespace"))
            {
                var nsName = ns.Attribute("Name")?.Value ?? "";
                foreach (var type in ns.Elements("Type"))
                {
                    var typeName = type.Attribute("Name")?.Value ?? "";
                    var fullTypeName = string.IsNullOrEmpty(nsName) ? typeName : $"{nsName}.{typeName}";

                    foreach (var method in type.Elements("Method"))
                    {
                        var methodName = method.Attribute("Name")?.Value ?? "";

                        foreach (var stmt in method.Elements("Statement"))
                        {
                            var filePath = NormalizePath(stmt.Attribute("File")?.Value ?? "", basePath);
                            var line = int.Parse(stmt.Attribute("Line")?.Value ?? "0");
                            var covered = stmt.Attribute("Covered")?.Value?.ToLower() == "true";

                            if (string.IsNullOrEmpty(filePath)) continue;

                            if (!fileStats.ContainsKey(filePath))
                                fileStats[filePath] = (0, 0);

                            var (total, cov) = fileStats[filePath];
                            fileStats[filePath] = (total + 1, cov + (covered ? 1 : 0));

                            if (covered && !result.Functions.Any(f => f.FilePath == filePath && f.Name == $"{fullTypeName}.{methodName}"))
                            {
                                result.Functions.Add(new FunctionCoverage
                                {
                                    Name = $"{fullTypeName}.{methodName}",
                                    FilePath = filePath,
                                    StartLine = line,
                                    EndLine = line,
                                    ExecutionCount = 1,
                                    IsCovered = true
                                });
                            }
                        }
                    }
                }
            }
        }

        foreach (var assembly in root.Elements("Assembly"))
        {
            ProcessAssembly(assembly);
        }

        foreach (var (filePath, (total, covered)) in fileStats)
        {
            if (covered > 0)
            {
                result.Files[filePath] = new FileCoverage
                {
                    FilePath = filePath,
                    CoveredLines = covered,
                    TotalLines = total,
                    CoveragePercent = total > 0 ? (double)covered / total * 100 : 0
                };
            }
        }

        return result;
    }

    #endregion

    #region Java Formats

    /// <summary>
    /// Parse JaCoCo XML format
    /// </summary>
    public static CoverageData ParseJacocoXml(string xmlPath, string? basePath = null)
    {
        var result = new CoverageData();
        var doc = XDocument.Load(xmlPath);
        var report = doc.Root;
        if (report?.Name.LocalName != "report") return result;

        foreach (var package in report.Elements("package"))
        {
            var pkgName = package.Attribute("name")?.Value ?? "";

            foreach (var cls in package.Elements("class"))
            {
                var className = cls.Attribute("name")?.Value ?? "";
                var sourceFile = cls.Attribute("sourcefilename")?.Value ?? "";
                var filePath = string.IsNullOrEmpty(pkgName)
                    ? sourceFile
                    : $"{pkgName}/{sourceFile}";
                filePath = NormalizePath(filePath, basePath);

                var counters = ParseJacocoCounters(cls.Elements("counter"));
                var lineCovered = counters.GetValueOrDefault("LINE", (Missed: 0, Covered: 0)).Covered;
                var lineMissed = counters.GetValueOrDefault("LINE", (Missed: 0, Covered: 0)).Missed;
                var lineTotal = lineCovered + lineMissed;

                if (lineCovered > 0)
                {
                    if (!result.Files.ContainsKey(filePath))
                    {
                        result.Files[filePath] = new FileCoverage
                        {
                            FilePath = filePath,
                            CoveredLines = lineCovered,
                            TotalLines = lineTotal,
                            CoveragePercent = lineTotal > 0 ? (double)lineCovered / lineTotal * 100 : 0
                        };
                    }

                    result.Functions.Add(new FunctionCoverage
                    {
                        Name = className.Replace('/', '.'),
                        FilePath = filePath,
                        StartLine = 1,
                        EndLine = 1,
                        ExecutionCount = lineCovered,
                        IsCovered = true
                    });
                }

                foreach (var method in cls.Elements("method"))
                {
                    var methodName = method.Attribute("name")?.Value ?? "";
                    var methodLine = int.Parse(method.Attribute("line")?.Value ?? "0");
                    var methodCounters = ParseJacocoCounters(method.Elements("counter"));
                    var methodCovered = methodCounters.GetValueOrDefault("LINE", (Missed: 0, Covered: 0)).Covered;

                    if (methodCovered > 0)
                    {
                        result.Functions.Add(new FunctionCoverage
                        {
                            Name = $"{className.Replace('/', '.')}.{methodName}",
                            FilePath = filePath,
                            StartLine = methodLine,
                            EndLine = methodLine,
                            ExecutionCount = methodCovered,
                            IsCovered = true
                        });
                    }
                }
            }
        }

        return result;
    }

    private static Dictionary<string, (int Missed, int Covered)> ParseJacocoCounters(IEnumerable<XElement> counters)
    {
        var result = new Dictionary<string, (int Missed, int Covered)>();
        foreach (var counter in counters)
        {
            var type = counter.Attribute("type")?.Value ?? "";
            var missed = int.Parse(counter.Attribute("missed")?.Value ?? "0");
            var covered = int.Parse(counter.Attribute("covered")?.Value ?? "0");
            result[type] = (missed, covered);
        }
        return result;
    }

    #endregion

    #region JavaScript Formats

    /// <summary>
    /// Parse Istanbul/nyc JSON format
    /// </summary>
    public static CoverageData ParseIstanbulJson(string jsonPath, string? basePath = null)
    {
        var result = new CoverageData();
        var json = File.ReadAllText(jsonPath);
        using var doc = JsonDocument.Parse(json);

        foreach (var file in doc.RootElement.EnumerateObject())
        {
            var filePath = NormalizePath(file.Name, basePath);
            var fileData = file.Value;

            if (!fileData.TryGetProperty("s", out var statements)) continue;

            int totalLines = 0, coveredLines = 0;
            foreach (var stmt in statements.EnumerateObject())
            {
                totalLines++;
                if (stmt.Value.GetInt32() > 0) coveredLines++;
            }

            if (fileData.TryGetProperty("f", out var functions) &&
                fileData.TryGetProperty("fnMap", out var fnMap))
            {
                foreach (var func in functions.EnumerateObject())
                {
                    var hits = func.Value.GetInt32();
                    if (hits <= 0) continue;

                    if (fnMap.TryGetProperty(func.Name, out var fnInfo))
                    {
                        var name = fnInfo.TryGetProperty("name", out var n) ? n.GetString() ?? $"anonymous_{func.Name}" : $"anonymous_{func.Name}";
                        var startLine = 1;
                        var endLine = 1;

                        if (fnInfo.TryGetProperty("decl", out var decl))
                        {
                            if (decl.TryGetProperty("start", out var start))
                                startLine = start.TryGetProperty("line", out var l) ? l.GetInt32() : 1;
                            if (decl.TryGetProperty("end", out var end))
                                endLine = end.TryGetProperty("line", out var l) ? l.GetInt32() : startLine;
                        }

                        result.Functions.Add(new FunctionCoverage
                        {
                            Name = name,
                            FilePath = filePath,
                            StartLine = startLine,
                            EndLine = endLine,
                            ExecutionCount = hits,
                            IsCovered = true
                        });
                    }
                }
            }

            if (coveredLines > 0)
            {
                result.Files[filePath] = new FileCoverage
                {
                    FilePath = filePath,
                    CoveredLines = coveredLines,
                    TotalLines = totalLines,
                    CoveragePercent = totalLines > 0 ? (double)coveredLines / totalLines * 100 : 0
                };
            }
        }

        return result;
    }

    #endregion

    #region Python Formats

    /// <summary>
    /// Parse coverage.py JSON format
    /// </summary>
    public static CoverageData ParseCoveragePyJson(string jsonPath, string? basePath = null)
    {
        var result = new CoverageData();
        var json = File.ReadAllText(jsonPath);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        if (!root.TryGetProperty("files", out var files)) return result;

        foreach (var file in files.EnumerateObject())
        {
            var filePath = NormalizePath(file.Name, basePath);
            var fileData = file.Value;

            var executedLines = fileData.TryGetProperty("executed_lines", out var ex) ? ex.GetArrayLength() : 0;
            var missingLines = fileData.TryGetProperty("missing_lines", out var mi) ? mi.GetArrayLength() : 0;
            var totalLines = executedLines + missingLines;

            if (executedLines > 0)
            {
                result.Files[filePath] = new FileCoverage
                {
                    FilePath = filePath,
                    CoveredLines = executedLines,
                    TotalLines = totalLines,
                    CoveragePercent = totalLines > 0 ? (double)executedLines / totalLines * 100 : 0
                };
            }
        }

        return result;
    }

    #endregion

    #region C/C++ Formats

    /// <summary>
    /// Parse Cobertura XML format
    /// </summary>
    public static CoverageData ParseCoberturaXml(string xmlPath, string? basePath = null)
    {
        var result = new CoverageData();
        var doc = XDocument.Load(xmlPath);
        var coverage = doc.Root;
        if (coverage?.Name.LocalName != "coverage") return result;

        var packages = coverage.Element("packages")?.Elements("package") ?? Enumerable.Empty<XElement>();

        foreach (var package in packages)
        {
            var classes = package.Element("classes")?.Elements("class") ?? Enumerable.Empty<XElement>();

            foreach (var cls in classes)
            {
                var filename = NormalizePath(cls.Attribute("filename")?.Value ?? "", basePath);
                var lineRate = double.Parse(cls.Attribute("line-rate")?.Value ?? "0");
                var className = cls.Attribute("name")?.Value ?? "";

                var classLines = cls.Element("lines")?.Elements("line").ToList() ?? [];
                var totalLines = classLines.Count;
                var coveredLines = classLines.Count(l => int.Parse(l.Attribute("hits")?.Value ?? "0") > 0);

                if (coveredLines > 0 && classLines.Count > 0)
                {
                    var lineNumbers = classLines.Select(l => int.Parse(l.Attribute("number")?.Value ?? "0")).ToList();
                    result.Functions.Add(new FunctionCoverage
                    {
                        Name = className,
                        FilePath = filename,
                        StartLine = lineNumbers.Min(),
                        EndLine = lineNumbers.Max(),
                        ExecutionCount = coveredLines,
                        IsCovered = true
                    });
                }

                var methods = cls.Element("methods")?.Elements("method") ?? Enumerable.Empty<XElement>();
                foreach (var method in methods)
                {
                    var methodName = method.Attribute("name")?.Value ?? "";
                    var methodLines = method.Element("lines")?.Elements("line").ToList() ?? [];
                    var methodCovered = methodLines.Count(l => int.Parse(l.Attribute("hits")?.Value ?? "0") > 0);

                    if (methodCovered > 0 && methodLines.Count > 0)
                    {
                        var lineNumbers = methodLines.Select(l => int.Parse(l.Attribute("number")?.Value ?? "0")).ToList();
                        result.Functions.Add(new FunctionCoverage
                        {
                            Name = $"{className}::{methodName}",
                            FilePath = filename,
                            StartLine = lineNumbers.Min(),
                            EndLine = lineNumbers.Max(),
                            ExecutionCount = methodCovered,
                            IsCovered = true
                        });
                    }
                }

                if (!result.Files.ContainsKey(filename) || result.Files[filename].CoveragePercent < lineRate * 100)
                {
                    result.Files[filename] = new FileCoverage
                    {
                        FilePath = filename,
                        CoveredLines = coveredLines,
                        TotalLines = totalLines,
                        CoveragePercent = lineRate * 100
                    };
                }
            }
        }

        return result;
    }

    /// <summary>
    /// Parse LCOV format (.info files)
    /// </summary>
    public static CoverageData ParseLcov(string lcovPath, string? basePath = null)
    {
        var result = new CoverageData();
        var lines = File.ReadAllLines(lcovPath);

        string? currentFile = null;
        int coveredLines = 0, totalLines = 0;
        var functions = new Dictionary<string, (int Line, int Hits)>();

        foreach (var line in lines)
        {
            if (line.StartsWith("SF:"))
            {
                currentFile = NormalizePath(line[3..], basePath);
                coveredLines = 0;
                totalLines = 0;
                functions.Clear();
            }
            else if (line.StartsWith("FN:") && currentFile != null)
            {
                var parts = line[3..].Split(',', 2);
                if (parts.Length >= 2)
                {
                    var lineNum = int.Parse(parts[0]);
                    var funcName = parts[1];
                    functions[funcName] = (lineNum, 0);
                }
            }
            else if (line.StartsWith("FNDA:") && currentFile != null)
            {
                var parts = line[5..].Split(',', 2);
                if (parts.Length >= 2)
                {
                    var hits = int.Parse(parts[0]);
                    var funcName = parts[1];
                    if (functions.TryGetValue(funcName, out var f))
                        functions[funcName] = (f.Line, hits);
                }
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
                if (coveredLines > 0)
                {
                    result.Files[currentFile] = new FileCoverage
                    {
                        FilePath = currentFile,
                        CoveredLines = coveredLines,
                        TotalLines = totalLines,
                        CoveragePercent = totalLines > 0 ? (double)coveredLines / totalLines * 100 : 0
                    };

                    foreach (var (funcName, (lineNum, hits)) in functions)
                    {
                        if (hits > 0)
                        {
                            result.Functions.Add(new FunctionCoverage
                            {
                                Name = funcName,
                                FilePath = currentFile,
                                StartLine = lineNum,
                                EndLine = lineNum,
                                ExecutionCount = hits,
                                IsCovered = true
                            });
                        }
                    }
                }
                currentFile = null;
            }
        }

        return result;
    }

    #endregion

    #region Lua Formats

    /// <summary>
    /// Parse LuaCov format (.out files)
    /// </summary>
    public static CoverageData ParseLuaCov(string luacovPath, string? basePath = null)
    {
        var result = new CoverageData();
        var content = File.ReadAllText(luacovPath);
        var fileName = Path.GetFileName(luacovPath).ToLowerInvariant();

        // Detect format
        if (fileName.Contains("stats") || IsLuaCovStatsFormat(content))
            return ParseLuaCovStats(content, basePath);
        else
            return ParseLuaCovReport(content, basePath);
    }

    private static bool IsLuaCovStatsFormat(string content)
    {
        var lines = content.Split('\n').Take(20);
        return lines.Any(l => l.Trim().EndsWith(".lua")) &&
               lines.Any(l => Regex.IsMatch(l.Trim(), @"^\d+:\d+$"));
    }

    private static CoverageData ParseLuaCovStats(string content, string? basePath)
    {
        var result = new CoverageData();
        string? currentFile = null;
        int totalLines = 0, coveredLines = 0;

        foreach (var line in content.Split('\n'))
        {
            var trimmed = line.Trim();
            if (string.IsNullOrEmpty(trimmed)) continue;

            if (trimmed.EndsWith(".lua") || (trimmed.Contains('/') && !trimmed.Contains(':')))
            {
                if (currentFile != null && coveredLines > 0)
                {
                    result.Files[currentFile] = new FileCoverage
                    {
                        FilePath = currentFile,
                        CoveredLines = coveredLines,
                        TotalLines = totalLines,
                        CoveragePercent = totalLines > 0 ? (double)coveredLines / totalLines * 100 : 0
                    };
                }
                currentFile = NormalizePath(trimmed, basePath);
                totalLines = 0;
                coveredLines = 0;
            }
            else if (Regex.IsMatch(trimmed, @"^\d+:\d+$") && currentFile != null)
            {
                var parts = trimmed.Split(':');
                var hits = int.Parse(parts[1]);
                totalLines++;
                if (hits > 0) coveredLines++;
            }
        }

        if (currentFile != null && coveredLines > 0)
        {
            result.Files[currentFile] = new FileCoverage
            {
                FilePath = currentFile,
                CoveredLines = coveredLines,
                TotalLines = totalLines,
                CoveragePercent = totalLines > 0 ? (double)coveredLines / totalLines * 100 : 0
            };
        }

        return result;
    }

    private static CoverageData ParseLuaCovReport(string content, string? basePath)
    {
        var result = new CoverageData();
        string? currentFile = null;
        int totalLines = 0, coveredLines = 0;
        var lines = content.Split('\n');

        for (int i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            var trimmed = line.Trim();

            if (trimmed.StartsWith(new string('=', 10)))
            {
                var nextLine = i + 1 < lines.Length ? lines[i + 1].Trim() : "";
                if (nextLine.EndsWith(".lua") || (nextLine.Contains('/') && nextLine.Contains('.')))
                {
                    if (currentFile != null && coveredLines > 0)
                    {
                        result.Files[currentFile] = new FileCoverage
                        {
                            FilePath = currentFile,
                            CoveredLines = coveredLines,
                            TotalLines = totalLines,
                            CoveragePercent = totalLines > 0 ? (double)coveredLines / totalLines * 100 : 0
                        };
                    }
                    currentFile = NormalizePath(nextLine, basePath);
                    totalLines = 0;
                    coveredLines = 0;
                    i++;
                }
            }
            else if (currentFile != null)
            {
                var match = Regex.Match(line, @"^([\s*]*)(\d+|\*+)\s+");
                if (match.Success)
                {
                    totalLines++;
                    var marker = match.Groups[1].Value.Trim();
                    var countStr = match.Groups[2].Value;
                    if (marker == "*" || (int.TryParse(countStr, out var count) && count > 0) || countStr.Contains('*'))
                        coveredLines++;
                }
            }
        }

        if (currentFile != null && coveredLines > 0)
        {
            result.Files[currentFile] = new FileCoverage
            {
                FilePath = currentFile,
                CoveredLines = coveredLines,
                TotalLines = totalLines,
                CoveragePercent = totalLines > 0 ? (double)coveredLines / totalLines * 100 : 0
            };
        }

        return result;
    }

    #endregion

    #region Generic/Auto-detect

    /// <summary>
    /// Try to auto-detect JSON format
    /// </summary>
    private static CoverageData ParseGenericJson(string jsonPath, string? basePath)
    {
        var json = File.ReadAllText(jsonPath);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        // Check for LLVM format
        if (root.TryGetProperty("data", out _))
            return ParseLlvmJson(jsonPath, basePath);

        // Check for coverage.py format
        if (root.TryGetProperty("meta", out _) && root.TryGetProperty("files", out _))
            return ParseCoveragePyJson(jsonPath, basePath);

        // Check for Istanbul format (object with file paths containing 's', 'f', 'b')
        var firstProp = root.EnumerateObject().FirstOrDefault();
        if (firstProp.Value.ValueKind == JsonValueKind.Object &&
            firstProp.Value.TryGetProperty("s", out _))
            return ParseIstanbulJson(jsonPath, basePath);

        // Default to Coverlet
        return ParseCoverletJson(jsonPath, basePath);
    }

    #endregion

    #region Helpers

    private static string NormalizePath(string path, string? basePath)
    {
        var normalized = path.Replace('\\', '/');

        if (!string.IsNullOrEmpty(basePath))
        {
            var normalizedBase = basePath.Replace('\\', '/');
            if (!normalizedBase.EndsWith('/')) normalizedBase += '/';
            if (normalized.StartsWith(normalizedBase))
                normalized = normalized[normalizedBase.Length..];
        }

        return normalized.TrimStart('/');
    }

    private static string RunCommand(string command, string arguments)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = command,
                Arguments = arguments,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        process.Start();

        // Read stdout and stderr to avoid deadlock
        var output = process.StandardOutput.ReadToEnd();
        var error = process.StandardError.ReadToEnd();

        process.WaitForExit();

        if (process.ExitCode != 0)
            throw new InvalidOperationException($"{command} failed with exit code {process.ExitCode}: {error}");

        return output;
    }

    private static async Task<string> RunCommandAsync(string command, string arguments, CancellationToken cancellationToken = default)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = command,
                Arguments = arguments,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        process.Start();

        // Read stdout and stderr asynchronously to avoid deadlock
        var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);

        await Task.WhenAll(outputTask, errorTask);
        await process.WaitForExitAsync(cancellationToken);

        var output = await outputTask;
        var error = await errorTask;

        if (process.ExitCode != 0)
            throw new InvalidOperationException($"{command} failed with exit code {process.ExitCode}: {error}");

        return output;
    }

    #endregion
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
