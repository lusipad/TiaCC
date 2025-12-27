// TiaCC CLI - 零依赖单文件可执行程序
// 内置 dotnet-coverage 调用、HTTP 服务器、离线报告生成

using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
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
            "serve" => await RunServeCommand(args[1..]),
            "report" => RunReportCommand(args[1..]),
            _ => PrintUnknownCommand(args[0])
        };
    }

    static void PrintHelp()
    {
        Console.WriteLine($@"
TiaCC v{Version} - 测试影响分析工具 (Test Impact Analysis for Code Coverage)

用法:
  tiacc <command> [options]

命令:
  collect   一键收集覆盖率并构建映射 (推荐)
  build     从已有覆盖率文件构建映射
  query     查询覆盖指定源文件的测试
  stats     显示数据库统计信息
  recommend 基于 Git 变更推荐测试
  serve     启动内置 Web 服务器查看 Dashboard (离线可用)
  report    生成独立的 HTML 报告文件 (离线可用)

示例:
  tiacc collect --command ""dotnet test""
  tiacc collect --command ""dotnet test MyProject.Tests"" --output ./coverage
  tiacc build --coverage-dir ./coverage --db impact_map.json
  tiacc query --db impact_map.json --file src/Services/UserService.cs
  tiacc recommend --db impact_map.json --base-ref origin/main
  tiacc serve --db impact_map.json --port 8080
  tiacc report --db impact_map.json --output report.html

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

    #region collect 命令

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

        Directory.CreateDirectory(options.OutputDir);
        var coverageFile = Path.Combine(options.OutputDir, $"coverage_{DateTime.Now:yyyyMMdd_HHmmss}.cobertura.xml");

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

        Console.WriteLine();
        Console.WriteLine("📁 解析覆盖率数据并构建映射...");

        var buildResult = await BuildMappingFromCoverage(coverageFile, options.DbPath, options.Verbose);

        if (!buildResult.Success)
        {
            Console.WriteLine($"❌ 映射构建失败: {buildResult.Error}");
            return 1;
        }

        Console.WriteLine();
        Console.WriteLine("═════════════════════════════════════════════════════════════");
        Console.WriteLine("✅ 构建完成!");
        Console.WriteLine($"   源文件数: {buildResult.SourceFiles}");
        Console.WriteLine($"   测试数:   {buildResult.Tests}");
        Console.WriteLine($"   映射数:   {buildResult.Mappings}");
        Console.WriteLine($"   数据库:   {options.DbPath}");
        Console.WriteLine();
        Console.WriteLine("💡 提示: 使用以下命令查看结果:");
        Console.WriteLine($"   tiacc serve --db {options.DbPath}");
        Console.WriteLine($"   tiacc report --db {options.DbPath} --output report.html");
        Console.WriteLine("═════════════════════════════════════════════════════════════");

        return 0;
    }

    #endregion

    #region build 命令

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

    #endregion

    #region query 命令

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

    #endregion

    #region stats 命令

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

    #endregion

    #region recommend 命令

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

    #endregion

    #region serve 命令 - 内置 HTTP 服务器

    static async Task<int> RunServeCommand(string[] args)
    {
        var dbPath = GetOption(args, "--db", "-d") ?? "impact_map.json";
        var portStr = GetOption(args, "--port", "-p") ?? "8080";

        if (!int.TryParse(portStr, out var port) || port < 1 || port > 65535)
        {
            Console.Error.WriteLine($"错误: 无效的端口号: {portStr}");
            return 1;
        }

        if (!File.Exists(dbPath))
        {
            Console.Error.WriteLine($"错误: 数据库文件不存在: {dbPath}");
            return 1;
        }

        var db = ImpactDatabase.Load(dbPath);

        Console.WriteLine("╔════════════════════════════════════════════════════════════╗");
        Console.WriteLine("║  TiaCC Dashboard - 内置 Web 服务器                         ║");
        Console.WriteLine("╚════════════════════════════════════════════════════════════╝");
        Console.WriteLine();
        Console.WriteLine($"📊 数据库: {dbPath}");
        Console.WriteLine($"🌐 服务器: http://localhost:{port}");
        Console.WriteLine();
        Console.WriteLine("按 Ctrl+C 停止服务器");
        Console.WriteLine();

        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://localhost:{port}/");
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");

        try
        {
            listener.Start();
        }
        catch (HttpListenerException ex)
        {
            Console.Error.WriteLine($"无法启动服务器: {ex.Message}");
            Console.Error.WriteLine($"请尝试其他端口: tiacc serve --port {port + 1}");
            return 1;
        }

        // 自动打开浏览器
        TryOpenBrowser($"http://localhost:{port}");

        var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        try
        {
            while (!cts.Token.IsCancellationRequested)
            {
                var contextTask = listener.GetContextAsync();
                var completedTask = await Task.WhenAny(contextTask, Task.Delay(-1, cts.Token));

                if (completedTask != contextTask) break;

                var context = await contextTask;
                _ = Task.Run(() => HandleHttpRequest(context, db));
            }
        }
        catch (OperationCanceledException)
        {
            // 正常退出
        }

        listener.Stop();
        Console.WriteLine("\n服务器已停止");
        return 0;
    }

    static void HandleHttpRequest(HttpListenerContext context, ImpactDatabase db)
    {
        var request = context.Request;
        var response = context.Response;

        try
        {
            var path = request.Url?.LocalPath ?? "/";
            Console.WriteLine($"  {request.HttpMethod} {path}");

            byte[] buffer;
            string contentType;

            switch (path)
            {
                case "/":
                case "/index.html":
                    buffer = Encoding.UTF8.GetBytes(EmbeddedDashboard.GetHtml(db));
                    contentType = "text/html; charset=utf-8";
                    break;

                case "/api/stats":
                    var stats = db.GetStats();
                    buffer = JsonSerializer.SerializeToUtf8Bytes(stats);
                    contentType = "application/json";
                    break;

                case "/api/mappings":
                    buffer = JsonSerializer.SerializeToUtf8Bytes(db.GetAllMappings());
                    contentType = "application/json";
                    break;

                case "/api/graph":
                    buffer = JsonSerializer.SerializeToUtf8Bytes(db.GetGraphData());
                    contentType = "application/json";
                    break;

                default:
                    response.StatusCode = 404;
                    buffer = Encoding.UTF8.GetBytes("Not Found");
                    contentType = "text/plain";
                    break;
            }

            response.ContentType = contentType;
            response.ContentLength64 = buffer.Length;
            response.OutputStream.Write(buffer, 0, buffer.Length);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"  错误: {ex.Message}");
            response.StatusCode = 500;
        }
        finally
        {
            response.Close();
        }
    }

    static void TryOpenBrowser(string url)
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            else if (OperatingSystem.IsMacOS())
            {
                Process.Start("open", url);
            }
            else if (OperatingSystem.IsLinux())
            {
                Process.Start("xdg-open", url);
            }
        }
        catch
        {
            // 忽略打开浏览器失败
        }
    }

    #endregion

    #region report 命令 - 生成离线 HTML 报告

    static int RunReportCommand(string[] args)
    {
        var dbPath = GetOption(args, "--db", "-d") ?? "impact_map.json";
        var outputPath = GetOption(args, "--output", "-o") ?? "tiacc_report.html";

        if (!File.Exists(dbPath))
        {
            Console.Error.WriteLine($"错误: 数据库文件不存在: {dbPath}");
            return 1;
        }

        Console.WriteLine("📊 生成离线 HTML 报告...");

        var db = ImpactDatabase.Load(dbPath);
        var html = EmbeddedDashboard.GetHtml(db);

        File.WriteAllText(outputPath, html, Encoding.UTF8);

        Console.WriteLine($"✅ 报告已生成: {outputPath}");
        Console.WriteLine();
        Console.WriteLine("💡 提示: 可以直接用浏览器打开此文件，无需网络连接");

        return 0;
    }

    #endregion

    #region dotnet-coverage 集成

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

    static async Task<(bool Success, string? Error, double DurationMs)> RunDotnetCoverage(
        string command, string outputFile, bool verbose)
    {
        var sw = Stopwatch.StartNew();

        try
        {
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

    static async Task<CoverageData?> ParseCoberturaXml(string filePath)
    {
        try
        {
            var content = await File.ReadAllTextAsync(filePath);
            var result = new CoverageData();

            var classRegex = new Regex(@"<class[^>]+filename=""([^""]+)""", RegexOptions.IgnoreCase);
            var classMatches = classRegex.Matches(content);

            foreach (Match match in classMatches)
            {
                var filename = match.Groups[1].Value;
                result.CoveredFiles.Add(NormalizePath(filename));
            }

            var methodRegex = new Regex(
                @"<method[^>]+name=""([^""]+)""[^>]*>[^<]*<lines>.*?</lines>.*?</method>",
                RegexOptions.IgnoreCase | RegexOptions.Singleline);

            var lineRegex = new Regex(@"<line[^>]+number=""(\d+)""", RegexOptions.IgnoreCase);

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

    static async Task<CoverageData?> ParseCoverageJson(string filePath)
    {
        try
        {
            var content = await File.ReadAllTextAsync(filePath);
            var result = new CoverageData();

            using var doc = JsonDocument.Parse(content);
            var root = doc.RootElement;

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
            // Git 不可用
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

    public List<MappingEntry> GetAllMappings()
    {
        var result = new List<MappingEntry>();
        foreach (var (file, tests) in FileMappings)
        {
            foreach (var test in tests)
            {
                result.Add(new MappingEntry { SourceFile = file, Test = test });
            }
        }
        return result;
    }

    public GraphData GetGraphData()
    {
        var nodes = new List<GraphNode>();
        var links = new List<GraphLink>();

        var sourceIds = new Dictionary<string, int>();
        var testIds = new Dictionary<string, int>();
        var nodeId = 0;

        // 添加源文件节点
        foreach (var file in FileMappings.Keys)
        {
            sourceIds[file] = nodeId;
            nodes.Add(new GraphNode
            {
                Id = nodeId++,
                Label = Path.GetFileName(file),
                FullPath = file,
                Type = "source"
            });
        }

        // 收集所有测试
        var allTests = new HashSet<string>();
        foreach (var tests in FileMappings.Values)
        {
            foreach (var test in tests)
            {
                allTests.Add(test);
            }
        }

        // 添加测试节点
        foreach (var test in allTests)
        {
            testIds[test] = nodeId;
            nodes.Add(new GraphNode
            {
                Id = nodeId++,
                Label = test,
                FullPath = test,
                Type = "test"
            });
        }

        // 添加连接
        foreach (var (file, tests) in FileMappings)
        {
            var sourceId = sourceIds[file];
            foreach (var test in tests)
            {
                var testId = testIds[test];
                links.Add(new GraphLink { Source = sourceId, Target = testId });
            }
        }

        return new GraphData { Nodes = nodes, Links = links };
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

class MappingEntry
{
    public string SourceFile { get; set; } = "";
    public string Test { get; set; } = "";
}

class GraphData
{
    public List<GraphNode> Nodes { get; set; } = new();
    public List<GraphLink> Links { get; set; } = new();
}

class GraphNode
{
    public int Id { get; set; }
    public string Label { get; set; } = "";
    public string FullPath { get; set; } = "";
    public string Type { get; set; } = "";
}

class GraphLink
{
    public int Source { get; set; }
    public int Target { get; set; }
}

#endregion

#region 内嵌 Dashboard - 完全离线可用

/// <summary>
/// 内嵌的 Dashboard HTML - 所有 CSS/JS 都内联，无外部依赖
/// </summary>
static class EmbeddedDashboard
{
    public static string GetHtml(ImpactDatabase db)
    {
        var stats = db.GetStats();
        var mappings = db.GetAllMappings();
        var graphData = db.GetGraphData();

        var graphJson = JsonSerializer.Serialize(graphData);
        var mappingsJson = JsonSerializer.Serialize(mappings);

        return $@"<!DOCTYPE html>
<html lang=""zh-CN"">
<head>
    <meta charset=""UTF-8"">
    <meta name=""viewport"" content=""width=device-width, initial-scale=1.0"">
    <title>TiaCC Dashboard - 测试影响分析</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}

        :root {{
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-card: #334155;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent-blue: #3b82f6;
            --accent-green: #10b981;
            --accent-purple: #8b5cf6;
            --accent-pink: #ec4899;
            --border-color: rgba(255,255,255,0.1);
        }}

        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
        }}

        .header {{
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            padding: 1rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }}

        .header h1 {{
            font-size: 1.5rem;
            background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }}

        .header .info {{
            color: var(--text-secondary);
            font-size: 0.875rem;
        }}

        .container {{
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
        }}

        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }}

        .stat-card {{
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.5rem;
            text-align: center;
        }}

        .stat-card .value {{
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }}

        .stat-card .label {{
            color: var(--text-secondary);
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }}

        .stat-card:nth-child(1) .value {{ color: var(--accent-blue); }}
        .stat-card:nth-child(2) .value {{ color: var(--accent-green); }}
        .stat-card:nth-child(3) .value {{ color: var(--accent-purple); }}
        .stat-card:nth-child(4) .value {{ color: var(--accent-pink); }}

        .panel {{
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            margin-bottom: 2rem;
            overflow: hidden;
        }}

        .panel-header {{
            padding: 1rem 1.5rem;
            border-bottom: 1px solid var(--border-color);
            font-weight: 600;
        }}

        .panel-body {{
            padding: 1.5rem;
        }}

        .graph-container {{
            height: 500px;
            position: relative;
        }}

        #graph {{
            width: 100%;
            height: 100%;
        }}

        .node-source {{ fill: var(--accent-blue); }}
        .node-test {{ fill: var(--accent-green); }}
        .node {{ cursor: pointer; }}
        .node:hover {{ filter: brightness(1.2); }}
        .link {{ stroke: var(--text-secondary); stroke-opacity: 0.3; }}

        .legend {{
            display: flex;
            gap: 2rem;
            padding: 1rem 1.5rem;
            border-top: 1px solid var(--border-color);
        }}

        .legend-item {{
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.875rem;
            color: var(--text-secondary);
        }}

        .legend-dot {{
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }}

        .table-container {{
            max-height: 400px;
            overflow-y: auto;
        }}

        table {{
            width: 100%;
            border-collapse: collapse;
        }}

        th, td {{
            padding: 0.75rem 1rem;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }}

        th {{
            background: var(--bg-card);
            font-weight: 600;
            position: sticky;
            top: 0;
        }}

        tr:hover td {{
            background: rgba(255,255,255,0.02);
        }}

        .search-box {{
            width: 100%;
            padding: 0.75rem 1rem;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            color: var(--text-primary);
            font-size: 0.875rem;
            margin-bottom: 1rem;
        }}

        .search-box:focus {{
            outline: none;
            border-color: var(--accent-blue);
        }}

        .tooltip {{
            position: absolute;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            pointer-events: none;
            z-index: 100;
            max-width: 300px;
            word-wrap: break-word;
        }}

        .file-path {{
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 0.8rem;
            color: var(--text-secondary);
        }}

        @media (max-width: 768px) {{
            .container {{ padding: 1rem; }}
            .stats-grid {{ grid-template-columns: repeat(2, 1fr); }}
            .stat-card .value {{ font-size: 1.75rem; }}
        }}
    </style>
</head>
<body>
    <header class=""header"">
        <h1>TiaCC Dashboard</h1>
        <div class=""info"">最后更新: {stats.LastUpdated:yyyy-MM-dd HH:mm:ss}</div>
    </header>

    <main class=""container"">
        <section class=""stats-grid"">
            <div class=""stat-card"">
                <div class=""value"">{stats.SourceFiles}</div>
                <div class=""label"">源文件</div>
            </div>
            <div class=""stat-card"">
                <div class=""value"">{stats.Tests}</div>
                <div class=""label"">测试</div>
            </div>
            <div class=""stat-card"">
                <div class=""value"">{stats.Mappings}</div>
                <div class=""label"">映射关系</div>
            </div>
            <div class=""stat-card"">
                <div class=""value"">{stats.Symbols}</div>
                <div class=""label"">符号</div>
            </div>
        </section>

        <section class=""panel"">
            <div class=""panel-header"">依赖关系图</div>
            <div class=""panel-body"">
                <div class=""graph-container"">
                    <svg id=""graph""></svg>
                </div>
            </div>
            <div class=""legend"">
                <div class=""legend-item"">
                    <div class=""legend-dot"" style=""background: var(--accent-blue)""></div>
                    <span>源文件</span>
                </div>
                <div class=""legend-item"">
                    <div class=""legend-dot"" style=""background: var(--accent-green)""></div>
                    <span>测试</span>
                </div>
            </div>
        </section>

        <section class=""panel"">
            <div class=""panel-header"">映射列表</div>
            <div class=""panel-body"">
                <input type=""text"" class=""search-box"" id=""searchBox"" placeholder=""搜索文件或测试..."">
                <div class=""table-container"">
                    <table id=""mappingsTable"">
                        <thead>
                            <tr>
                                <th>源文件</th>
                                <th>测试</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>
        </section>
    </main>

    <div class=""tooltip"" id=""tooltip"" style=""display: none""></div>

    <script>
        // 数据
        const graphData = {graphJson};
        const mappings = {mappingsJson};

        // 初始化图形
        function initGraph() {{
            const container = document.querySelector('.graph-container');
            const svg = document.getElementById('graph');
            const width = container.clientWidth;
            const height = container.clientHeight;

            svg.setAttribute('viewBox', `0 0 ${{width}} ${{height}}`);

            if (graphData.Nodes.length === 0) {{
                svg.innerHTML = '<text x=""50%"" y=""50%"" text-anchor=""middle"" fill=""#94a3b8"">暂无数据</text>';
                return;
            }}

            // 简单的力导向布局
            const nodes = graphData.Nodes.map((n, i) => ({{
                ...n,
                x: width / 2 + (Math.random() - 0.5) * width * 0.8,
                y: height / 2 + (Math.random() - 0.5) * height * 0.8,
                vx: 0,
                vy: 0
            }}));

            const links = graphData.Links.map(l => ({{
                source: nodes[l.Source],
                target: nodes[l.Target]
            }}));

            // 简化的力模拟
            for (let i = 0; i < 100; i++) {{
                // 斥力
                for (let a = 0; a < nodes.length; a++) {{
                    for (let b = a + 1; b < nodes.length; b++) {{
                        const dx = nodes[b].x - nodes[a].x;
                        const dy = nodes[b].y - nodes[a].y;
                        const d = Math.sqrt(dx * dx + dy * dy) || 1;
                        const force = 500 / (d * d);
                        nodes[a].vx -= dx / d * force;
                        nodes[a].vy -= dy / d * force;
                        nodes[b].vx += dx / d * force;
                        nodes[b].vy += dy / d * force;
                    }}
                }}

                // 引力（连接）
                for (const link of links) {{
                    const dx = link.target.x - link.source.x;
                    const dy = link.target.y - link.source.y;
                    const d = Math.sqrt(dx * dx + dy * dy) || 1;
                    const force = (d - 100) * 0.01;
                    link.source.vx += dx / d * force;
                    link.source.vy += dy / d * force;
                    link.target.vx -= dx / d * force;
                    link.target.vy -= dy / d * force;
                }}

                // 中心引力
                for (const node of nodes) {{
                    node.vx += (width / 2 - node.x) * 0.001;
                    node.vy += (height / 2 - node.y) * 0.001;
                }}

                // 应用速度
                for (const node of nodes) {{
                    node.vx *= 0.9;
                    node.vy *= 0.9;
                    node.x += node.vx;
                    node.y += node.vy;
                    node.x = Math.max(20, Math.min(width - 20, node.x));
                    node.y = Math.max(20, Math.min(height - 20, node.y));
                }}
            }}

            // 绘制连接
            let html = '';
            for (const link of links) {{
                html += `<line class=""link"" x1=""${{link.source.x}}"" y1=""${{link.source.y}}"" x2=""${{link.target.x}}"" y2=""${{link.target.y}}""/>`;
            }}

            // 绘制节点
            for (const node of nodes) {{
                const cls = node.Type === 'source' ? 'node-source' : 'node-test';
                html += `<circle class=""node ${{cls}}"" cx=""${{node.x}}"" cy=""${{node.y}}"" r=""8"" data-label=""${{node.Label}}"" data-path=""${{node.FullPath}}""/>`;
            }}

            svg.innerHTML = html;

            // 添加交互
            const tooltip = document.getElementById('tooltip');
            svg.querySelectorAll('.node').forEach(node => {{
                node.addEventListener('mouseenter', e => {{
                    tooltip.innerHTML = `<strong>${{e.target.dataset.label}}</strong><br><span class=""file-path"">${{e.target.dataset.path}}</span>`;
                    tooltip.style.display = 'block';
                    tooltip.style.left = e.pageX + 10 + 'px';
                    tooltip.style.top = e.pageY + 10 + 'px';
                }});
                node.addEventListener('mouseleave', () => {{
                    tooltip.style.display = 'none';
                }});
            }});
        }}

        // 初始化表格
        function initTable() {{
            const tbody = document.querySelector('#mappingsTable tbody');
            const searchBox = document.getElementById('searchBox');

            function renderTable(filter = '') {{
                const filtered = mappings.filter(m =>
                    m.SourceFile.toLowerCase().includes(filter) ||
                    m.Test.toLowerCase().includes(filter)
                );

                tbody.innerHTML = filtered.slice(0, 100).map(m => `
                    <tr>
                        <td class=""file-path"">${{m.SourceFile}}</td>
                        <td>${{m.Test}}</td>
                    </tr>
                `).join('');

                if (filtered.length > 100) {{
                    tbody.innerHTML += `<tr><td colspan=""2"" style=""text-align:center;color:var(--text-secondary)"">... 还有 ${{filtered.length - 100}} 条记录</td></tr>`;
                }}
            }}

            renderTable();

            searchBox.addEventListener('input', e => {{
                renderTable(e.target.value.toLowerCase());
            }});
        }}

        // 初始化
        initGraph();
        initTable();

        // 窗口调整时重绘
        window.addEventListener('resize', initGraph);
    </script>
</body>
</html>";
    }
}

#endregion
