// TiaCC CLI - 零依赖单文件可执行程序
// 内置 dotnet-coverage 调用，支持一键覆盖率收集和映射构建

using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace TiaCC.Cli;

/// <summary>
/// TiaCC CLI 入口点
/// 用法: tiacc collect --command "dotnet test" [选项]
/// </summary>
class Program
{
    private static readonly string Version = "1.0.0";

    static async Task<int> Main(string[] args)
    {
        if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
        {
            PrintHelp();
            return 0;
        }

        if (args[0] is "-v" or "--version" or "version")
        {
            Console.WriteLine($"tiacc version {Version}");
            return 0;
        }

        return args[0].ToLower() switch
        {
            "collect" => await RunCollectCommand(args[1..]),
            "build" => await RunBuildCommand(args[1..]),
            "query" => RunQueryCommand(args[1..]),
            "stats" => RunStatsCommand(args[1..]),
            "recommend" => await RunRecommendCommand(args[1..]),
            _ => PrintUnknownCommand(args[0])
        };
    }

    static void PrintHelp()
    {
        Console.WriteLine(@"
TiaCC - 测试影响分析工具 (Test Impact Analysis for Code Coverage)

用法:
  tiacc <command> [options]

命令:
  collect   一键收集覆盖率并构建映射 (推荐)
  build     从已有覆盖率文件构建映射
  query     查询覆盖指定源文件的测试
  stats     显示数据库统计信息
  recommend 基于 Git 变更推荐测试

示例:
  tiacc collect --command ""dotnet test""
  tiacc collect --command ""dotnet test MyProject.Tests"" --output ./coverage
  tiacc build --coverage-dir ./coverage --db impact_map.json
  tiacc query --db impact_map.json --file src/Services/UserService.cs
  tiacc recommend --db impact_map.json --base-ref origin/main

选项:
  -h, --help      显示帮助信息
  -v, --version   显示版本号
");
    }

    static int PrintUnknownCommand(string command)
    {
        Console.Error.WriteLine($"错误: 未知命令 '{command}'");
        Console.Error.WriteLine("使用 'tiacc --help' 查看可用命令");
        return 1;
    }

    /// <summary>
    /// collect 命令 - 一键收集覆盖率并构建映射
    /// </summary>
    static async Task<int> RunCollectCommand(string[] args)
    {
        var options = ParseCollectOptions(args);

        if (string.IsNullOrEmpty(options.Command))
        {
            Console.Error.WriteLine("错误: 必须指定 --command 参数");
            Console.Error.WriteLine("用法: tiacc collect --command \"dotnet test\"");
            return 1;
        }

        Console.WriteLine("╔════════════════════════════════════════════════════════════╗");
        Console.WriteLine("║  TiaCC - 测试覆盖率收集与映射构建                          ║");
        Console.WriteLine("╚════════════════════════════════════════════════════════════╝");
        Console.WriteLine();

        // 步骤1: 检查 dotnet-coverage 是否可用
        Console.Write("🔍 检查 dotnet-coverage 工具...");
        if (!await CheckDotnetCoverageAvailable())
        {
            Console.WriteLine(" ❌");
            Console.WriteLine();
            Console.WriteLine("dotnet-coverage 工具未安装。请运行以下命令安装:");
            Console.WriteLine("  dotnet tool install --global dotnet-coverage");
            return 1;
        }
        Console.WriteLine(" ✓");

        // 步骤2: 创建输出目录
        Directory.CreateDirectory(options.OutputDir);
        var coverageFile = Path.Combine(options.OutputDir, $"coverage_{DateTime.Now:yyyyMMdd_HHmmss}.cobertura.xml");

        // 步骤3: 运行测试并收集覆盖率
        Console.WriteLine();
        Console.WriteLine($"📊 运行测试并收集覆盖率...");
        Console.WriteLine($"   命令: {options.Command}");
        Console.WriteLine($"   输出: {coverageFile}");
        Console.WriteLine();

        var collectResult = await RunDotnetCoverage(options.Command, coverageFile, options.Verbose);

        if (!collectResult.Success)
        {
            Console.WriteLine();
            Console.WriteLine($"❌ 覆盖率收集失败: {collectResult.Error}");
            return 1;
        }

        Console.WriteLine();
        Console.WriteLine($"✓ 覆盖率收集完成 (耗时: {collectResult.DurationMs:F1}ms)");

        // 步骤4: 解析覆盖率并构建映射
        Console.WriteLine();
        Console.WriteLine("📁 解析覆盖率数据并构建映射...");

        var buildResult = await BuildMappingFromCoverage(coverageFile, options.DbPath, options.Verbose);

        if (!buildResult.Success)
        {
            Console.WriteLine($"❌ 映射构建失败: {buildResult.Error}");
            return 1;
        }

        // 步骤5: 显示统计
        Console.WriteLine();
        Console.WriteLine("═════════════════════════════════════════════════════════════");
        Console.WriteLine("✅ 构建完成!");
        Console.WriteLine($"   源文件数: {buildResult.SourceFiles}");
        Console.WriteLine($"   测试数:   {buildResult.Tests}");
        Console.WriteLine($"   映射数:   {buildResult.Mappings}");
        Console.WriteLine($"   数据库:   {options.DbPath}");
        Console.WriteLine("═════════════════════════════════════════════════════════════");

        return 0;
    }

    /// <summary>
    /// build 命令 - 从已有覆盖率文件构建映射
    /// </summary>
    static async Task<int> RunBuildCommand(string[] args)
    {
        var coverageDir = GetOption(args, "--coverage-dir", "-c") ?? "./coverage";
        var dbPath = GetOption(args, "--db", "-d") ?? "impact_map.json";
        var verbose = HasFlag(args, "--verbose", "-v");

        Console.WriteLine("📁 扫描覆盖率文件...");

        var coverageFiles = Directory.Exists(coverageDir)
            ? Directory.GetFiles(coverageDir, "*.cobertura.xml")
                .Concat(Directory.GetFiles(coverageDir, "*.coverage.json"))
                .Concat(Directory.GetFiles(coverageDir, "*.xml"))
                .ToArray()
            : [];

        if (coverageFiles.Length == 0)
        {
            Console.WriteLine($"未在 {coverageDir} 找到覆盖率文件");
            return 1;
        }

        Console.WriteLine($"找到 {coverageFiles.Length} 个覆盖率文件");

        var db = ImpactDatabase.Load(dbPath);
        var totalSources = new HashSet<string>();
        var totalTests = 0;
        var totalMappings = 0;

        foreach (var file in coverageFiles)
        {
            Console.WriteLine($"  处理: {Path.GetFileName(file)}");

            var coverage = await ParseCoverageFile(file);
            if (coverage == null) continue;

            var testName = Path.GetFileNameWithoutExtension(file)
                .Replace(".cobertura", "")
                .Replace(".coverage", "");

            foreach (var sourceFile in coverage.CoveredFiles)
            {
                db.AddMapping(sourceFile, testName);
                totalSources.Add(sourceFile);
                totalMappings++;
            }

            // 添加符号级映射
            foreach (var symbol in coverage.Symbols)
            {
                db.AddSymbol(symbol.FilePath, symbol.Name, symbol.StartLine, symbol.EndLine, testName);
            }

            totalTests++;
        }

        db.Save(dbPath);

        Console.WriteLine();
        Console.WriteLine($"✓ 构建完成!");
        Console.WriteLine($"  源文件: {totalSources.Count}");
        Console.WriteLine($"  测试:   {totalTests}");
        Console.WriteLine($"  映射:   {totalMappings}");

        return 0;
    }

    /// <summary>
    /// query 命令 - 查询覆盖指定源文件的测试
    /// </summary>
    static int RunQueryCommand(string[] args)
    {
        var dbPath = GetOption(args, "--db", "-d") ?? "impact_map.json";
        var filePath = GetOption(args, "--file", "-f") ?? args.FirstOrDefault(a => !a.StartsWith("-"));

        if (string.IsNullOrEmpty(filePath))
        {
            Console.Error.WriteLine("错误: 必须指定要查询的文件路径");
            return 1;
        }

        if (!File.Exists(dbPath))
        {
            Console.Error.WriteLine($"错误: 数据库文件不存在: {dbPath}");
            return 1;
        }

        var db = ImpactDatabase.Load(dbPath);
        var tests = db.GetTestsForFile(filePath);

        if (tests.Count == 0)
        {
            Console.WriteLine($"未找到覆盖 '{filePath}' 的测试");
            return 0;
        }

        Console.WriteLine($"覆盖 '{filePath}' 的测试:");
        foreach (var test in tests)
        {
            Console.WriteLine($"  - {test}");
        }

        return 0;
    }

    /// <summary>
    /// stats 命令 - 显示统计信息
    /// </summary>
    static int RunStatsCommand(string[] args)
    {
        var dbPath = GetOption(args, "--db", "-d") ?? "impact_map.json";

        if (!File.Exists(dbPath))
        {
            Console.Error.WriteLine($"错误: 数据库文件不存在: {dbPath}");
            return 1;
        }

        var db = ImpactDatabase.Load(dbPath);
        var stats = db.GetStats();

        Console.WriteLine($"数据库: {dbPath}");
        Console.WriteLine($"  源文件数:   {stats.SourceFiles}");
        Console.WriteLine($"  测试数:     {stats.Tests}");
        Console.WriteLine($"  映射数:     {stats.Mappings}");
        Console.WriteLine($"  符号数:     {stats.Symbols}");
        Console.WriteLine($"  最后更新:   {stats.LastUpdated:yyyy-MM-dd HH:mm:ss}");

        return 0;
    }

    /// <summary>
    /// recommend 命令 - 基于 Git 变更推荐测试
    /// </summary>
    static async Task<int> RunRecommendCommand(string[] args)
    {
        var dbPath = GetOption(args, "--db", "-d") ?? "impact_map.json";
        var baseRef = GetOption(args, "--base-ref", "-b") ?? "origin/main";
        var json = HasFlag(args, "--json", "-j");

        if (!File.Exists(dbPath))
        {
            Console.Error.WriteLine($"错误: 数据库文件不存在: {dbPath}");
            return 1;
        }

        var db = ImpactDatabase.Load(dbPath);

        // 获取变更的文件
        var changedFiles = await GetGitChangedFiles(baseRef);

        if (changedFiles.Count == 0)
        {
            if (json)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { tests = Array.Empty<string>(), changedFiles = Array.Empty<string>() }));
            }
            else
            {
                Console.WriteLine("未检测到变更文件");
            }
            return 0;
        }

        // 查找受影响的测试
        var affectedTests = new HashSet<string>();
        foreach (var file in changedFiles)
        {
            var tests = db.GetTestsForFile(file);
            foreach (var test in tests)
            {
                affectedTests.Add(test);
            }
        }

        if (json)
        {
            var result = new
            {
                tests = affectedTests.OrderBy(t => t).ToArray(),
                changedFiles = changedFiles.ToArray(),
                totalTests = db.GetStats().Tests,
                savingsPercent = db.GetStats().Tests > 0
                    ? Math.Round((1.0 - (double)affectedTests.Count / db.GetStats().Tests) * 100, 1)
                    : 0
            };
            Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
        }
        else
        {
            Console.WriteLine($"变更的文件 ({changedFiles.Count}):");
            foreach (var file in changedFiles.Take(10))
            {
                Console.WriteLine($"  {file}");
            }
            if (changedFiles.Count > 10)
            {
                Console.WriteLine($"  ... 还有 {changedFiles.Count - 10} 个文件");
            }

            Console.WriteLine();
            Console.WriteLine($"推荐运行的测试 ({affectedTests.Count}):");
            foreach (var test in affectedTests.OrderBy(t => t))
            {
                Console.WriteLine($"  - {test}");
            }

            if (affectedTests.Count > 0 && db.GetStats().Tests > 0)
            {
                var savings = (1.0 - (double)affectedTests.Count / db.GetStats().Tests) * 100;
                Console.WriteLine();
                Console.WriteLine($"预计节省: {savings:F1}% 的测试时间");
            }
        }

        return 0;
    }

    #region dotnet-coverage 集成

    /// <summary>
    /// 检查 dotnet-coverage 工具是否可用
    /// </summary>
    static async Task<bool> CheckDotnetCoverageAvailable()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "dotnet-coverage",
                Arguments = "--version",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process == null) return false;

            await process.WaitForExitAsync();
            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// 运行 dotnet-coverage 收集覆盖率
    /// </summary>
    static async Task<(bool Success, string? Error, double DurationMs)> RunDotnetCoverage(
        string command, string outputFile, bool verbose)
    {
        var sw = Stopwatch.StartNew();

        try
        {
            // dotnet-coverage collect --output <file> --output-format cobertura <command>
            var args = $"collect --output \"{outputFile}\" --output-format cobertura {command}";

            var psi = new ProcessStartInfo
            {
                FileName = "dotnet-coverage",
                Arguments = args,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            if (verbose)
            {
                Console.WriteLine($"执行: dotnet-coverage {args}");
            }

            using var process = Process.Start(psi);
            if (process == null)
            {
                return (false, "无法启动 dotnet-coverage 进程", sw.ElapsedMilliseconds);
            }

            // 实时输出
            var outputTask = Task.Run(async () =>
            {
                while (!process.StandardOutput.EndOfStream)
                {
                    var line = await process.StandardOutput.ReadLineAsync();
                    if (verbose && !string.IsNullOrEmpty(line))
                    {
                        Console.WriteLine($"  {line}");
                    }
                }
            });

            var errorOutput = new StringBuilder();
            var errorTask = Task.Run(async () =>
            {
                while (!process.StandardError.EndOfStream)
                {
                    var line = await process.StandardError.ReadLineAsync();
                    if (!string.IsNullOrEmpty(line))
                    {
                        errorOutput.AppendLine(line);
                        if (verbose)
                        {
                            Console.WriteLine($"  [ERR] {line}");
                        }
                    }
                }
            });

            await Task.WhenAll(outputTask, errorTask);
            await process.WaitForExitAsync();

            sw.Stop();

            if (process.ExitCode != 0)
            {
                return (false, errorOutput.ToString(), sw.ElapsedMilliseconds);
            }

            if (!File.Exists(outputFile))
            {
                return (false, "覆盖率文件未生成", sw.ElapsedMilliseconds);
            }

            return (true, null, sw.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            return (false, ex.Message, sw.ElapsedMilliseconds);
        }
    }

    #endregion

    #region 覆盖率解析

    /// <summary>
    /// 解析覆盖率文件
    /// </summary>
    static async Task<CoverageData?> ParseCoverageFile(string filePath)
    {
        var extension = Path.GetExtension(filePath).ToLower();

        return extension switch
        {
            ".xml" => await ParseCoberturaXml(filePath),
            ".json" => await ParseCoverageJson(filePath),
            _ => null
        };
    }

    /// <summary>
    /// 解析 Cobertura XML 格式
    /// </summary>
    static async Task<CoverageData?> ParseCoberturaXml(string filePath)
    {
        try
        {
            var content = await File.ReadAllTextAsync(filePath);
            var result = new CoverageData();

            // 简单的 XML 解析（不使用 XmlDocument 以保持零依赖）
            // 匹配 <class filename="...">
            var classRegex = new Regex(@"<class[^>]+filename=""([^""]+)""", RegexOptions.IgnoreCase);
            var classMatches = classRegex.Matches(content);

            foreach (Match match in classMatches)
            {
                var filename = match.Groups[1].Value;
                result.CoveredFiles.Add(NormalizePath(filename));
            }

            // 匹配 <method name="..." line-rate="...">
            var methodRegex = new Regex(
                @"<method[^>]+name=""([^""]+)""[^>]*>[^<]*<lines>.*?</lines>.*?</method>",
                RegexOptions.IgnoreCase | RegexOptions.Singleline);

            var lineRegex = new Regex(@"<line[^>]+number=""(\d+)""", RegexOptions.IgnoreCase);

            // 从 package 和 class 标签获取文件路径
            var packageClassRegex = new Regex(
                @"<class[^>]+name=""([^""]+)""[^>]+filename=""([^""]+)""[^>]*>.*?</class>",
                RegexOptions.IgnoreCase | RegexOptions.Singleline);

            foreach (Match classMatch in packageClassRegex.Matches(content))
            {
                var className = classMatch.Groups[1].Value;
                var filename = classMatch.Groups[2].Value;

                var classContent = classMatch.Value;
                var methods = methodRegex.Matches(classContent);

                foreach (Match methodMatch in methods)
                {
                    var methodName = methodMatch.Groups[1].Value;
                    var methodContent = methodMatch.Value;
                    var lines = lineRegex.Matches(methodContent);

                    if (lines.Count > 0)
                    {
                        var startLine = lines.Cast<Match>().Min(m => int.Parse(m.Groups[1].Value));
                        var endLine = lines.Cast<Match>().Max(m => int.Parse(m.Groups[1].Value));

                        result.Symbols.Add(new CoveredSymbol
                        {
                            FilePath = NormalizePath(filename),
                            Name = $"{className}.{methodName}",
                            StartLine = startLine,
                            EndLine = endLine
                        });
                    }
                }
            }

            return result;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"解析覆盖率文件失败: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// 解析 JSON 格式覆盖率（Coverlet JSON）
    /// </summary>
    static async Task<CoverageData?> ParseCoverageJson(string filePath)
    {
        try
        {
            var content = await File.ReadAllTextAsync(filePath);
            var result = new CoverageData();

            using var doc = JsonDocument.Parse(content);
            var root = doc.RootElement;

            // Coverlet JSON 格式: { "ModuleName": { "FilePath": { "ClassName.MethodName": { "Lines": {...} } } } }
            foreach (var module in root.EnumerateObject())
            {
                foreach (var file in module.Value.EnumerateObject())
                {
                    var filePath2 = NormalizePath(file.Name);
                    result.CoveredFiles.Add(filePath2);

                    foreach (var method in file.Value.EnumerateObject())
                    {
                        var methodName = method.Name;

                        if (method.Value.TryGetProperty("Lines", out var lines))
                        {
                            var lineNumbers = lines.EnumerateObject()
                                .Select(l => int.Parse(l.Name))
                                .ToList();

                            if (lineNumbers.Count > 0)
                            {
                                result.Symbols.Add(new CoveredSymbol
                                {
                                    FilePath = filePath2,
                                    Name = methodName,
                                    StartLine = lineNumbers.Min(),
                                    EndLine = lineNumbers.Max()
                                });
                            }
                        }
                    }
                }
            }

            return result;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"解析覆盖率 JSON 失败: {ex.Message}");
            return null;
        }
    }

    #endregion

    #region 映射构建

    /// <summary>
    /// 从覆盖率文件构建映射
    /// </summary>
    static async Task<(bool Success, string? Error, int SourceFiles, int Tests, int Mappings)> BuildMappingFromCoverage(
        string coverageFile, string dbPath, bool verbose)
    {
        try
        {
            var coverage = await ParseCoverageFile(coverageFile);
            if (coverage == null)
            {
                return (false, "无法解析覆盖率文件", 0, 0, 0);
            }

            var db = File.Exists(dbPath) ? ImpactDatabase.Load(dbPath) : new ImpactDatabase();

            var testName = Path.GetFileNameWithoutExtension(coverageFile)
                .Replace(".cobertura", "");

            var mappings = 0;
            foreach (var sourceFile in coverage.CoveredFiles)
            {
                db.AddMapping(sourceFile, testName);
                mappings++;

                if (verbose)
                {
                    Console.WriteLine($"  映射: {sourceFile} -> {testName}");
                }
            }

            // 添加符号映射
            foreach (var symbol in coverage.Symbols)
            {
                db.AddSymbol(symbol.FilePath, symbol.Name, symbol.StartLine, symbol.EndLine, testName);
            }

            db.Save(dbPath);

            var stats = db.GetStats();
            return (true, null, stats.SourceFiles, stats.Tests, mappings);
        }
        catch (Exception ex)
        {
            return (false, ex.Message, 0, 0, 0);
        }
    }

    #endregion

    #region Git 集成

    /// <summary>
    /// 获取 Git 变更的文件
    /// </summary>
    static async Task<List<string>> GetGitChangedFiles(string baseRef)
    {
        var result = new List<string>();

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "git",
                Arguments = $"diff --name-only {baseRef}",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process == null) return result;

            var output = await process.StandardOutput.ReadToEndAsync();
            await process.WaitForExitAsync();

            if (process.ExitCode == 0)
            {
                result.AddRange(output
                    .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                    .Select(l => l.Trim())
                    .Where(l => !string.IsNullOrEmpty(l)));
            }
        }
        catch
        {
            // Git 不可用或不在 Git 仓库中
        }

        return result;
    }

    #endregion

    #region 辅助方法

    static CollectOptions ParseCollectOptions(string[] args)
    {
        return new CollectOptions
        {
            Command = GetOption(args, "--command", "-c"),
            OutputDir = GetOption(args, "--output", "-o") ?? "./coverage",
            DbPath = GetOption(args, "--db", "-d") ?? "impact_map.json",
            Verbose = HasFlag(args, "--verbose", "-v")
        };
    }

    static string? GetOption(string[] args, string longName, string shortName)
    {
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == longName || args[i] == shortName)
            {
                return args[i + 1];
            }
        }
        return null;
    }

    static bool HasFlag(string[] args, string longName, string shortName)
    {
        return args.Contains(longName) || args.Contains(shortName);
    }

    static string NormalizePath(string path)
    {
        return path.Replace('\\', '/');
    }

    #endregion
}

#region 数据模型

class CollectOptions
{
    public string? Command { get; set; }
    public string OutputDir { get; set; } = "./coverage";
    public string DbPath { get; set; } = "impact_map.json";
    public bool Verbose { get; set; }
}

class CoverageData
{
    public HashSet<string> CoveredFiles { get; } = new();
    public List<CoveredSymbol> Symbols { get; } = new();
}

class CoveredSymbol
{
    public string FilePath { get; set; } = "";
    public string Name { get; set; } = "";
    public int StartLine { get; set; }
    public int EndLine { get; set; }
}

/// <summary>
/// 简单的 JSON 文件数据库 - 零依赖实现
/// </summary>
class ImpactDatabase
{
    public Dictionary<string, HashSet<string>> FileMappings { get; set; } = new();
    public Dictionary<string, SymbolInfo> Symbols { get; set; } = new();
    public DateTime LastUpdated { get; set; } = DateTime.UtcNow;

    public static ImpactDatabase Load(string path)
    {
        if (!File.Exists(path))
        {
            return new ImpactDatabase();
        }

        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<ImpactDatabase>(json) ?? new ImpactDatabase();
        }
        catch
        {
            return new ImpactDatabase();
        }
    }

    public void Save(string path)
    {
        LastUpdated = DateTime.UtcNow;
        var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(path, json);
    }

    public void AddMapping(string sourceFile, string test)
    {
        if (!FileMappings.TryGetValue(sourceFile, out var tests))
        {
            tests = new HashSet<string>();
            FileMappings[sourceFile] = tests;
        }
        tests.Add(test);
    }

    public void AddSymbol(string filePath, string name, int startLine, int endLine, string test)
    {
        var key = $"{filePath}:{name}:{startLine}";
        if (!Symbols.TryGetValue(key, out var symbol))
        {
            symbol = new SymbolInfo
            {
                FilePath = filePath,
                Name = name,
                StartLine = startLine,
                EndLine = endLine
            };
            Symbols[key] = symbol;
        }
        symbol.Tests.Add(test);
    }

    public List<string> GetTestsForFile(string filePath)
    {
        var normalized = filePath.Replace('\\', '/');
        var result = new HashSet<string>();

        foreach (var (file, tests) in FileMappings)
        {
            if (file.EndsWith(normalized) || normalized.EndsWith(file) ||
                file.Contains(normalized) || normalized.Contains(file))
            {
                foreach (var test in tests)
                {
                    result.Add(test);
                }
            }
        }

        return result.ToList();
    }

    public DatabaseStats GetStats()
    {
        var allTests = new HashSet<string>();
        var mappingCount = 0;

        foreach (var tests in FileMappings.Values)
        {
            foreach (var test in tests)
            {
                allTests.Add(test);
            }
            mappingCount += tests.Count;
        }

        return new DatabaseStats
        {
            SourceFiles = FileMappings.Count,
            Tests = allTests.Count,
            Mappings = mappingCount,
            Symbols = Symbols.Count,
            LastUpdated = LastUpdated
        };
    }
}

class SymbolInfo
{
    public string FilePath { get; set; } = "";
    public string Name { get; set; } = "";
    public int StartLine { get; set; }
    public int EndLine { get; set; }
    public HashSet<string> Tests { get; set; } = new();
}

class DatabaseStats
{
    public int SourceFiles { get; set; }
    public int Tests { get; set; }
    public int Mappings { get; set; }
    public int Symbols { get; set; }
    public DateTime LastUpdated { get; set; }
}

#endregion
