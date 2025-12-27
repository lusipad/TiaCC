// TiaCC CLI - 零依赖单文件可执行程序
// 内置 dotnet-coverage 和 LLVM 覆盖率工具调用，支持 C# 和 C++ 项目

using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TiaCC.Cli;

/// <summary>
/// TiaCC CLI 入口点
/// 用法: tiacc collect --command "测试命令" [选项]
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

collect 命令选项:
  --command, -c <cmd>     要执行的测试命令 (必需)
  --type, -t <type>       项目类型: dotnet, cpp, auto (默认: auto)
  --executable, -e <path> C++ 可执行文件路径 (cpp 类型必需)
  --output, -o <dir>      覆盖率输出目录 (默认: ./coverage)
  --db, -d <path>         映射数据库路径 (默认: impact_map.json)
  --verbose               详细输出

示例:
  # C# 项目
  tiacc collect --command ""dotnet test""
  tiacc collect -t dotnet -c ""dotnet test MyProject.Tests""

  # C++ 项目 (需要 clang 编译并启用覆盖率)
  tiacc collect -t cpp -c ""./build/tests/run_tests"" -e ""./build/tests/run_tests""
  tiacc collect -t cpp -c ""ctest --test-dir build"" -e ""./build/bin/myapp""

  # 其他命令
  tiacc build --coverage-dir ./coverage --db impact_map.json
  tiacc query --db impact_map.json --file src/Services/UserService.cs
  tiacc recommend --db impact_map.json --base-ref origin/main
  tiacc serve --db impact_map.json --port 8080
  tiacc report --db impact_map.json --output report.html

C++ 项目配置说明:
  1. 使用 clang/clang++ 编译时添加覆盖率标志:
     CXXFLAGS=""-fprofile-instr-generate -fcoverage-mapping""
     LDFLAGS=""-fprofile-instr-generate""

  2. CMake 示例:
     cmake -DCMAKE_CXX_FLAGS=""-fprofile-instr-generate -fcoverage-mapping"" ..

  3. 确保安装了 LLVM 工具: llvm-profdata, llvm-cov

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
            Console.Error.WriteLine("      tiacc collect --type cpp --command \"./run_tests\" --executable \"./run_tests\"");
            return 1;
        }

        // 自动检测项目类型
        if (options.Type == ProjectType.Auto)
        {
            options.Type = DetectProjectType(options.Command);
            Console.WriteLine($"🔍 自动检测项目类型: {options.Type}");
        }

        Console.WriteLine("╔════════════════════════════════════════════════════════════╗");
        Console.WriteLine("║  TiaCC - 测试覆盖率收集与映射构建                          ║");
        Console.WriteLine("╚════════════════════════════════════════════════════════════╝");
        Console.WriteLine();
        Console.WriteLine($"📋 项目类型: {options.Type}");
        Console.WriteLine($"📋 测试命令: {options.Command}");
        Console.WriteLine();

        return options.Type switch
        {
            ProjectType.Dotnet => await CollectDotnetCoverage(options),
            ProjectType.Cpp => await CollectCppCoverage(options),
            _ => await CollectDotnetCoverage(options)
        };
    }

    static ProjectType DetectProjectType(string command)
    {
        var cmd = command.ToLower();

        if (cmd.Contains("dotnet") || cmd.Contains("msbuild") || cmd.Contains("vstest"))
            return ProjectType.Dotnet;

        if (cmd.Contains("ctest") || cmd.Contains("gtest") || cmd.Contains("catch2"))
            return ProjectType.Cpp;

        // 检查是否有 .csproj/.sln 文件
        if (Directory.GetFiles(".", "*.csproj").Length > 0 ||
            Directory.GetFiles(".", "*.sln").Length > 0)
            return ProjectType.Dotnet;

        // 检查是否有 CMakeLists.txt
        if (File.Exists("CMakeLists.txt") || File.Exists("build/CMakeCache.txt"))
            return ProjectType.Cpp;

        return ProjectType.Dotnet; // 默认
    }

    #endregion

    #region C# 覆盖率收集

    static async Task<int> CollectDotnetCoverage(CollectOptions options)
    {
        Console.Write("🔍 检查 dotnet-coverage 工具...");
        if (!await CheckToolAvailable("dotnet-coverage", "--version"))
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
        Console.WriteLine($"   输出: {coverageFile}");
        Console.WriteLine();

        var collectArgs = $"collect --output \"{coverageFile}\" --output-format cobertura {options.Command}";
        var result = await RunProcess("dotnet-coverage", collectArgs, options.Verbose);

        if (!result.Success)
        {
            Console.WriteLine($"❌ 覆盖率收集失败: {result.Error}");
            return 1;
        }

        Console.WriteLine($"✓ 覆盖率收集完成 (耗时: {result.DurationMs:F1}ms)");

        return await BuildAndSave(coverageFile, options);
    }

    #endregion

    #region C++ 覆盖率收集

    static async Task<int> CollectCppCoverage(CollectOptions options)
    {
        // 检查 LLVM 工具
        Console.Write("🔍 检查 LLVM 工具...");

        var hasLlvmProfdata = await CheckToolAvailable("llvm-profdata", "--version");
        var hasLlvmCov = await CheckToolAvailable("llvm-cov", "--version");

        if (!hasLlvmProfdata || !hasLlvmCov)
        {
            Console.WriteLine(" ❌");
            Console.WriteLine();
            Console.WriteLine("LLVM 覆盖率工具未安装。请确保安装了以下工具:");
            Console.WriteLine("  - llvm-profdata");
            Console.WriteLine("  - llvm-cov");
            Console.WriteLine();
            Console.WriteLine("安装方式:");
            Console.WriteLine("  Ubuntu/Debian: sudo apt install llvm");
            Console.WriteLine("  macOS: brew install llvm");
            Console.WriteLine("  Windows: 下载 LLVM 并添加到 PATH");
            return 1;
        }
        Console.WriteLine(" ✓");

        // 检查可执行文件
        if (string.IsNullOrEmpty(options.Executable))
        {
            Console.Error.WriteLine("错误: C++ 项目需要指定 --executable 参数");
            Console.Error.WriteLine("用法: tiacc collect -t cpp -c \"./run_tests\" -e \"./run_tests\"");
            return 1;
        }

        if (!File.Exists(options.Executable))
        {
            Console.Error.WriteLine($"错误: 可执行文件不存在: {options.Executable}");
            return 1;
        }

        Directory.CreateDirectory(options.OutputDir);

        // 设置 profraw 输出路径
        var profrawFile = Path.Combine(options.OutputDir, $"coverage_{DateTime.Now:yyyyMMdd_HHmmss}.profraw");
        var profdataFile = Path.ChangeExtension(profrawFile, ".profdata");
        var jsonFile = Path.ChangeExtension(profrawFile, ".cov.json");

        Console.WriteLine();
        Console.WriteLine($"📊 运行测试并收集覆盖率...");
        Console.WriteLine($"   LLVM_PROFILE_FILE: {profrawFile}");
        Console.WriteLine();

        // 步骤 1: 运行测试，设置 LLVM_PROFILE_FILE 环境变量
        var env = new Dictionary<string, string>
        {
            ["LLVM_PROFILE_FILE"] = profrawFile
        };

        var result = await RunProcess(options.Command, "", options.Verbose, env, useShell: true);

        if (!result.Success)
        {
            Console.WriteLine($"⚠️ 测试命令返回非零退出码，但继续处理覆盖率数据...");
        }

        // 检查 profraw 文件是否生成
        if (!File.Exists(profrawFile))
        {
            // 尝试查找其他 profraw 文件
            var profrawFiles = Directory.GetFiles(options.OutputDir, "*.profraw");
            if (profrawFiles.Length == 0)
            {
                profrawFiles = Directory.GetFiles(".", "*.profraw");
            }

            if (profrawFiles.Length > 0)
            {
                profrawFile = profrawFiles[0];
                Console.WriteLine($"   找到 profraw 文件: {profrawFile}");
            }
            else
            {
                Console.Error.WriteLine("❌ 未找到 .profraw 文件");
                Console.Error.WriteLine("   请确保程序是用覆盖率标志编译的:");
                Console.Error.WriteLine("   clang++ -fprofile-instr-generate -fcoverage-mapping ...");
                return 1;
            }
        }

        Console.WriteLine($"✓ 测试完成 (耗时: {result.DurationMs:F1}ms)");

        // 步骤 2: 合并 profraw 文件
        Console.WriteLine();
        Console.Write("📁 合并覆盖率数据 (llvm-profdata merge)...");

        var mergeResult = await RunProcess("llvm-profdata",
            $"merge -sparse \"{profrawFile}\" -o \"{profdataFile}\"",
            options.Verbose);

        if (!mergeResult.Success)
        {
            Console.WriteLine(" ❌");
            Console.Error.WriteLine($"llvm-profdata 失败: {mergeResult.Error}");
            return 1;
        }
        Console.WriteLine(" ✓");

        // 步骤 3: 导出为 JSON
        Console.Write("📁 导出覆盖率 JSON (llvm-cov export)...");

        var exportResult = await RunProcess("llvm-cov",
            $"export \"{options.Executable}\" -instr-profile=\"{profdataFile}\" -format=text",
            options.Verbose, captureOutput: true);

        if (!exportResult.Success)
        {
            Console.WriteLine(" ❌");
            Console.Error.WriteLine($"llvm-cov export 失败: {exportResult.Error}");
            return 1;
        }

        await File.WriteAllTextAsync(jsonFile, exportResult.Output);
        Console.WriteLine(" ✓");

        // 步骤 4: 解析并构建映射
        return await BuildAndSave(jsonFile, options);
    }

    #endregion

    #region 公共构建逻辑

    static async Task<int> BuildAndSave(string coverageFile, CollectOptions options)
    {
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
        Console.WriteLine($"   符号数:   {buildResult.Symbols}");
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

        if (!Directory.Exists(coverageDir))
        {
            Console.WriteLine($"目录不存在: {coverageDir}");
            return 1;
        }

        var coverageFiles = Directory.GetFiles(coverageDir, "*.cobertura.xml")
            .Concat(Directory.GetFiles(coverageDir, "*.coverage.json"))
            .Concat(Directory.GetFiles(coverageDir, "*.cov.json"))  // LLVM JSON
            .ToArray();

        if (coverageFiles.Length == 0)
        {
            Console.WriteLine($"未在 {coverageDir} 找到覆盖率文件");
            Console.WriteLine("支持的格式: *.cobertura.xml, *.coverage.json, *.cov.json");
            return 1;
        }

        Console.WriteLine($"找到 {coverageFiles.Length} 个覆盖率文件");

        var db = ImpactDatabase.Load(dbPath);
        var totalSources = new HashSet<string>();
        var totalTests = 0;
        var totalMappings = 0;
        var totalSymbols = 0;

        foreach (var file in coverageFiles)
        {
            Console.WriteLine($"  处理: {Path.GetFileName(file)}");

            var coverage = await ParseCoverageFile(file);
            if (coverage == null) continue;

            var testName = Path.GetFileNameWithoutExtension(file)
                .Replace(".cobertura", "")
                .Replace(".coverage", "")
                .Replace(".cov", "");

            foreach (var sourceFile in coverage.CoveredFiles)
            {
                db.AddMapping(sourceFile, testName);
                totalSources.Add(sourceFile);
                totalMappings++;
            }

            foreach (var symbol in coverage.Symbols)
            {
                db.AddSymbol(symbol.FilePath, symbol.Name, symbol.StartLine, symbol.EndLine, testName);
                totalSymbols++;
            }

            totalTests++;
        }

        db.Save(dbPath);

        Console.WriteLine();
        Console.WriteLine($"✓ 构建完成!");
        Console.WriteLine($"  源文件: {totalSources.Count}");
        Console.WriteLine($"  测试:   {totalTests}");
        Console.WriteLine($"  映射:   {totalMappings}");
        Console.WriteLine($"  符号:   {totalSymbols}");

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

    #region serve 命令

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
                    buffer = JsonSerializer.SerializeToUtf8Bytes(db.GetStats());
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
        catch { }
    }

    #endregion

    #region report 命令

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

    #region 进程执行

    static async Task<bool> CheckToolAvailable(string tool, string args)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = tool,
                Arguments = args,
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

    static async Task<ProcessResult> RunProcess(
        string fileName,
        string arguments,
        bool verbose,
        Dictionary<string, string>? env = null,
        bool useShell = false,
        bool captureOutput = false)
    {
        var sw = Stopwatch.StartNew();

        try
        {
            ProcessStartInfo psi;

            if (useShell)
            {
                // 使用 shell 执行命令
                if (OperatingSystem.IsWindows())
                {
                    psi = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = $"/c {fileName} {arguments}",
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                }
                else
                {
                    psi = new ProcessStartInfo
                    {
                        FileName = "/bin/sh",
                        Arguments = $"-c \"{fileName} {arguments}\"",
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                }
            }
            else
            {
                psi = new ProcessStartInfo
                {
                    FileName = fileName,
                    Arguments = arguments,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
            }

            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;

            if (env != null)
            {
                foreach (var (key, value) in env)
                {
                    psi.EnvironmentVariables[key] = value;
                }
            }

            if (verbose)
            {
                Console.WriteLine($"执行: {fileName} {arguments}");
            }

            using var process = Process.Start(psi);
            if (process == null)
            {
                return new ProcessResult { Success = false, Error = "无法启动进程" };
            }

            var outputBuilder = new StringBuilder();
            var errorBuilder = new StringBuilder();

            var outputTask = Task.Run(async () =>
            {
                while (!process.StandardOutput.EndOfStream)
                {
                    var line = await process.StandardOutput.ReadLineAsync();
                    if (captureOutput)
                    {
                        outputBuilder.AppendLine(line);
                    }
                    if (verbose && !string.IsNullOrEmpty(line))
                    {
                        Console.WriteLine($"  {line}");
                    }
                }
            });

            var errorTask = Task.Run(async () =>
            {
                while (!process.StandardError.EndOfStream)
                {
                    var line = await process.StandardError.ReadLineAsync();
                    if (!string.IsNullOrEmpty(line))
                    {
                        errorBuilder.AppendLine(line);
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

            return new ProcessResult
            {
                Success = process.ExitCode == 0,
                Output = outputBuilder.ToString(),
                Error = errorBuilder.ToString(),
                ExitCode = process.ExitCode,
                DurationMs = sw.ElapsedMilliseconds
            };
        }
        catch (Exception ex)
        {
            return new ProcessResult { Success = false, Error = ex.Message, DurationMs = sw.ElapsedMilliseconds };
        }
    }

    #endregion

    #region 覆盖率解析

    static async Task<CoverageData?> ParseCoverageFile(string filePath)
    {
        var fileName = Path.GetFileName(filePath).ToLower();

        if (fileName.EndsWith(".cov.json"))
        {
            return await ParseLlvmCovJson(filePath);
        }
        else if (fileName.EndsWith(".cobertura.xml") || fileName.EndsWith(".xml"))
        {
            return await ParseCoberturaXml(filePath);
        }
        else if (fileName.EndsWith(".coverage.json") || fileName.EndsWith(".json"))
        {
            return await ParseCoverletJson(filePath);
        }

        return null;
    }

    /// <summary>
    /// 解析 LLVM llvm-cov export 输出的 JSON 格式
    /// </summary>
    static async Task<CoverageData?> ParseLlvmCovJson(string filePath)
    {
        try
        {
            var content = await File.ReadAllTextAsync(filePath);
            var result = new CoverageData();

            using var doc = JsonDocument.Parse(content);
            var root = doc.RootElement;

            // LLVM 格式: { "data": [ { "files": [ { "filename": "...", "segments": [...], "functions": [...] } ] } ] }
            if (!root.TryGetProperty("data", out var dataArray))
                return result;

            foreach (var data in dataArray.EnumerateArray())
            {
                if (!data.TryGetProperty("files", out var filesArray))
                    continue;

                foreach (var file in filesArray.EnumerateArray())
                {
                    if (!file.TryGetProperty("filename", out var filenameEl))
                        continue;

                    var filename = NormalizePath(filenameEl.GetString() ?? "");
                    if (string.IsNullOrEmpty(filename)) continue;

                    // 检查是否有覆盖
                    var hasCoverage = false;
                    if (file.TryGetProperty("segments", out var segments))
                    {
                        foreach (var seg in segments.EnumerateArray())
                        {
                            var arr = seg.EnumerateArray().ToArray();
                            if (arr.Length >= 3 && arr[2].GetInt32() > 0)
                            {
                                hasCoverage = true;
                                break;
                            }
                        }
                    }

                    if (hasCoverage)
                    {
                        result.CoveredFiles.Add(filename);
                    }

                    // 提取函数级信息
                    if (file.TryGetProperty("functions", out var functions))
                    {
                        foreach (var func in functions.EnumerateArray())
                        {
                            if (!func.TryGetProperty("name", out var nameEl))
                                continue;

                            var funcName = nameEl.GetString() ?? "";
                            var count = 0;
                            var startLine = 0;
                            var endLine = 0;

                            if (func.TryGetProperty("count", out var countEl))
                                count = countEl.GetInt32();

                            if (func.TryGetProperty("regions", out var regions))
                            {
                                var regionList = regions.EnumerateArray().ToList();
                                if (regionList.Count > 0)
                                {
                                    var firstRegion = regionList[0].EnumerateArray().ToArray();
                                    var lastRegion = regionList[^1].EnumerateArray().ToArray();

                                    if (firstRegion.Length >= 2)
                                        startLine = firstRegion[0].GetInt32();
                                    if (lastRegion.Length >= 4)
                                        endLine = lastRegion[2].GetInt32();
                                }
                            }

                            if (count > 0 && !string.IsNullOrEmpty(funcName))
                            {
                                result.Symbols.Add(new CoveredSymbol
                                {
                                    FilePath = filename,
                                    Name = DemangleName(funcName),
                                    StartLine = startLine,
                                    EndLine = endLine > 0 ? endLine : startLine
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
            Console.Error.WriteLine($"解析 LLVM JSON 失败: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// 简单的 C++ 名称 demangle
    /// </summary>
    static string DemangleName(string mangledName)
    {
        // 简单处理：去掉参数签名
        var idx = mangledName.IndexOf('(');
        if (idx > 0)
            mangledName = mangledName[..idx];

        // 处理 MSVC 修饰
        if (mangledName.StartsWith("?"))
        {
            var parts = mangledName.Split('@');
            if (parts.Length >= 2)
            {
                return parts[1] + "::" + parts[0].TrimStart('?');
            }
        }

        return mangledName;
    }

    static async Task<CoverageData?> ParseCoberturaXml(string filePath)
    {
        try
        {
            var content = await File.ReadAllTextAsync(filePath);
            var result = new CoverageData();

            var classRegex = new Regex(@"<class[^>]+filename=""([^""]+)""", RegexOptions.IgnoreCase);
            foreach (Match match in classRegex.Matches(content))
            {
                result.CoveredFiles.Add(NormalizePath(match.Groups[1].Value));
            }

            var packageClassRegex = new Regex(
                @"<class[^>]+name=""([^""]+)""[^>]+filename=""([^""]+)""[^>]*>.*?</class>",
                RegexOptions.IgnoreCase | RegexOptions.Singleline);

            var methodRegex = new Regex(
                @"<method[^>]+name=""([^""]+)""[^>]*>.*?<lines>(.*?)</lines>.*?</method>",
                RegexOptions.IgnoreCase | RegexOptions.Singleline);

            var lineRegex = new Regex(@"<line[^>]+number=""(\d+)""", RegexOptions.IgnoreCase);

            foreach (Match classMatch in packageClassRegex.Matches(content))
            {
                var className = classMatch.Groups[1].Value;
                var filename = classMatch.Groups[2].Value;

                foreach (Match methodMatch in methodRegex.Matches(classMatch.Value))
                {
                    var methodName = methodMatch.Groups[1].Value;
                    var linesContent = methodMatch.Groups[2].Value;
                    var lines = lineRegex.Matches(linesContent)
                        .Cast<Match>()
                        .Select(m => int.Parse(m.Groups[1].Value))
                        .ToList();

                    if (lines.Count > 0)
                    {
                        result.Symbols.Add(new CoveredSymbol
                        {
                            FilePath = NormalizePath(filename),
                            Name = $"{className}.{methodName}",
                            StartLine = lines.Min(),
                            EndLine = lines.Max()
                        });
                    }
                }
            }

            return result;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"解析 Cobertura XML 失败: {ex.Message}");
            return null;
        }
    }

    static async Task<CoverageData?> ParseCoverletJson(string filePath)
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
                                    Name = method.Name,
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
            Console.Error.WriteLine($"解析 Coverlet JSON 失败: {ex.Message}");
            return null;
        }
    }

    #endregion

    #region 映射构建

    static async Task<BuildResult> BuildMappingFromCoverage(string coverageFile, string dbPath, bool verbose)
    {
        try
        {
            var coverage = await ParseCoverageFile(coverageFile);
            if (coverage == null)
            {
                return new BuildResult { Success = false, Error = "无法解析覆盖率文件" };
            }

            var db = File.Exists(dbPath) ? ImpactDatabase.Load(dbPath) : new ImpactDatabase();

            var testName = Path.GetFileNameWithoutExtension(coverageFile)
                .Replace(".cobertura", "")
                .Replace(".coverage", "")
                .Replace(".cov", "");

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

            var symbols = 0;
            foreach (var symbol in coverage.Symbols)
            {
                db.AddSymbol(symbol.FilePath, symbol.Name, symbol.StartLine, symbol.EndLine, testName);
                symbols++;

                if (verbose)
                {
                    Console.WriteLine($"  符号: {symbol.Name} [{symbol.StartLine}-{symbol.EndLine}]");
                }
            }

            db.Save(dbPath);

            var stats = db.GetStats();
            return new BuildResult
            {
                Success = true,
                SourceFiles = stats.SourceFiles,
                Tests = stats.Tests,
                Mappings = mappings,
                Symbols = symbols
            };
        }
        catch (Exception ex)
        {
            return new BuildResult { Success = false, Error = ex.Message };
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
        catch { }

        return result;
    }

    #endregion

    #region 辅助方法

    static CollectOptions ParseCollectOptions(string[] args)
    {
        var typeStr = GetOption(args, "--type", "-t") ?? "auto";
        var type = typeStr.ToLower() switch
        {
            "dotnet" or "csharp" or "cs" => ProjectType.Dotnet,
            "cpp" or "c++" or "llvm" => ProjectType.Cpp,
            _ => ProjectType.Auto
        };

        return new CollectOptions
        {
            Command = GetOption(args, "--command", "-c"),
            Type = type,
            Executable = GetOption(args, "--executable", "-e"),
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

enum ProjectType { Auto, Dotnet, Cpp }

class CollectOptions
{
    public string? Command { get; set; }
    public ProjectType Type { get; set; } = ProjectType.Auto;
    public string? Executable { get; set; }
    public string OutputDir { get; set; } = "./coverage";
    public string DbPath { get; set; } = "impact_map.json";
    public bool Verbose { get; set; }
}

class ProcessResult
{
    public bool Success { get; set; }
    public string Output { get; set; } = "";
    public string? Error { get; set; }
    public int ExitCode { get; set; }
    public double DurationMs { get; set; }
}

class BuildResult
{
    public bool Success { get; set; }
    public string? Error { get; set; }
    public int SourceFiles { get; set; }
    public int Tests { get; set; }
    public int Mappings { get; set; }
    public int Symbols { get; set; }
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
        if (!File.Exists(path)) return new ImpactDatabase();

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
                    result.Add(test);
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
                allTests.Add(test);
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
            foreach (var test in tests)
                result.Add(new MappingEntry { SourceFile = file, Test = test });
        return result;
    }

    public GraphData GetGraphData()
    {
        var nodes = new List<GraphNode>();
        var links = new List<GraphLink>();
        var sourceIds = new Dictionary<string, int>();
        var testIds = new Dictionary<string, int>();
        var nodeId = 0;

        foreach (var file in FileMappings.Keys)
        {
            sourceIds[file] = nodeId;
            nodes.Add(new GraphNode { Id = nodeId++, Label = Path.GetFileName(file), FullPath = file, Type = "source" });
        }

        var allTests = new HashSet<string>();
        foreach (var tests in FileMappings.Values)
            foreach (var test in tests)
                allTests.Add(test);

        foreach (var test in allTests)
        {
            testIds[test] = nodeId;
            nodes.Add(new GraphNode { Id = nodeId++, Label = test, FullPath = test, Type = "test" });
        }

        foreach (var (file, tests) in FileMappings)
        {
            var sourceId = sourceIds[file];
            foreach (var test in tests)
                links.Add(new GraphLink { Source = sourceId, Target = testIds[test] });
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

#region 内嵌 Dashboard

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
        *{{margin:0;padding:0;box-sizing:border-box}}
        :root{{--bg:#0f172a;--bg2:#1e293b;--bg3:#334155;--text:#f8fafc;--text2:#94a3b8;--blue:#3b82f6;--green:#10b981;--purple:#8b5cf6;--pink:#ec4899;--border:rgba(255,255,255,0.1)}}
        body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}}
        .header{{background:var(--bg2);border-bottom:1px solid var(--border);padding:1rem 2rem;display:flex;justify-content:space-between;align-items:center}}
        .header h1{{font-size:1.5rem;background:linear-gradient(135deg,var(--blue),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent}}
        .header .info{{color:var(--text2);font-size:.875rem}}
        .container{{max-width:1400px;margin:0 auto;padding:2rem}}
        .stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1.5rem;margin-bottom:2rem}}
        .stat{{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:1.5rem;text-align:center}}
        .stat .v{{font-size:2.5rem;font-weight:700;margin-bottom:.5rem}}
        .stat .l{{color:var(--text2);font-size:.875rem;text-transform:uppercase}}
        .stat:nth-child(1) .v{{color:var(--blue)}}.stat:nth-child(2) .v{{color:var(--green)}}.stat:nth-child(3) .v{{color:var(--purple)}}.stat:nth-child(4) .v{{color:var(--pink)}}
        .panel{{background:var(--bg2);border:1px solid var(--border);border-radius:12px;margin-bottom:2rem;overflow:hidden}}
        .panel-h{{padding:1rem 1.5rem;border-bottom:1px solid var(--border);font-weight:600}}
        .panel-b{{padding:1.5rem}}
        .graph{{height:500px}}#graph{{width:100%;height:100%}}
        .node-source{{fill:var(--blue)}}.node-test{{fill:var(--green)}}.node{{cursor:pointer}}.node:hover{{filter:brightness(1.2)}}.link{{stroke:var(--text2);stroke-opacity:.3}}
        .legend{{display:flex;gap:2rem;padding:1rem 1.5rem;border-top:1px solid var(--border)}}
        .legend-i{{display:flex;align-items:center;gap:.5rem;font-size:.875rem;color:var(--text2)}}
        .legend-d{{width:12px;height:12px;border-radius:50%}}
        .tbl-wrap{{max-height:400px;overflow-y:auto}}
        table{{width:100%;border-collapse:collapse}}
        th,td{{padding:.75rem 1rem;text-align:left;border-bottom:1px solid var(--border)}}
        th{{background:var(--bg3);font-weight:600;position:sticky;top:0}}
        tr:hover td{{background:rgba(255,255,255,.02)}}
        .search{{width:100%;padding:.75rem 1rem;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.875rem;margin-bottom:1rem}}
        .search:focus{{outline:none;border-color:var(--blue)}}
        .tooltip{{position:absolute;background:var(--bg3);border:1px solid var(--border);padding:8px 12px;border-radius:6px;font-size:12px;pointer-events:none;z-index:100;max-width:300px}}
        .fp{{font-family:Consolas,Monaco,monospace;font-size:.8rem;color:var(--text2)}}
        @media(max-width:768px){{.container{{padding:1rem}}.stats{{grid-template-columns:repeat(2,1fr)}}.stat .v{{font-size:1.75rem}}}}
    </style>
</head>
<body>
    <header class=""header""><h1>TiaCC Dashboard</h1><div class=""info"">更新: {stats.LastUpdated:yyyy-MM-dd HH:mm:ss}</div></header>
    <main class=""container"">
        <section class=""stats"">
            <div class=""stat""><div class=""v"">{stats.SourceFiles}</div><div class=""l"">源文件</div></div>
            <div class=""stat""><div class=""v"">{stats.Tests}</div><div class=""l"">测试</div></div>
            <div class=""stat""><div class=""v"">{stats.Mappings}</div><div class=""l"">映射</div></div>
            <div class=""stat""><div class=""v"">{stats.Symbols}</div><div class=""l"">符号</div></div>
        </section>
        <section class=""panel""><div class=""panel-h"">依赖关系图</div><div class=""panel-b""><div class=""graph""><svg id=""graph""></svg></div></div>
            <div class=""legend""><div class=""legend-i""><div class=""legend-d"" style=""background:var(--blue)""></div><span>源文件</span></div><div class=""legend-i""><div class=""legend-d"" style=""background:var(--green)""></div><span>测试</span></div></div></section>
        <section class=""panel""><div class=""panel-h"">映射列表</div><div class=""panel-b""><input type=""text"" class=""search"" id=""s"" placeholder=""搜索...""><div class=""tbl-wrap""><table id=""t""><thead><tr><th>源文件</th><th>测试</th></tr></thead><tbody></tbody></table></div></div></section>
    </main>
    <div class=""tooltip"" id=""tip"" style=""display:none""></div>
    <script>
        const G={graphJson},M={mappingsJson};
        function initGraph(){{const c=document.querySelector('.graph'),svg=document.getElementById('graph'),w=c.clientWidth,h=c.clientHeight;svg.setAttribute('viewBox',`0 0 ${{w}} ${{h}}`);if(!G.Nodes.length){{svg.innerHTML='<text x=""50%"" y=""50%"" text-anchor=""middle"" fill=""#94a3b8"">暂无数据</text>';return}}const nodes=G.Nodes.map(n=>({{...n,x:w/2+(Math.random()-.5)*w*.8,y:h/2+(Math.random()-.5)*h*.8,vx:0,vy:0}})),links=G.Links.map(l=>({{source:nodes[l.Source],target:nodes[l.Target]}}));for(let i=0;i<100;i++){{for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++){{const dx=nodes[b].x-nodes[a].x,dy=nodes[b].y-nodes[a].y,d=Math.sqrt(dx*dx+dy*dy)||1,f=500/(d*d);nodes[a].vx-=dx/d*f;nodes[a].vy-=dy/d*f;nodes[b].vx+=dx/d*f;nodes[b].vy+=dy/d*f}}for(const l of links){{const dx=l.target.x-l.source.x,dy=l.target.y-l.source.y,d=Math.sqrt(dx*dx+dy*dy)||1,f=(d-100)*.01;l.source.vx+=dx/d*f;l.source.vy+=dy/d*f;l.target.vx-=dx/d*f;l.target.vy-=dy/d*f}}for(const n of nodes){{n.vx+=(w/2-n.x)*.001;n.vy+=(h/2-n.y)*.001;n.vx*=.9;n.vy*=.9;n.x+=n.vx;n.y+=n.vy;n.x=Math.max(20,Math.min(w-20,n.x));n.y=Math.max(20,Math.min(h-20,n.y))}}}}let html='';for(const l of links)html+=`<line class=""link"" x1=""${{l.source.x}}"" y1=""${{l.source.y}}"" x2=""${{l.target.x}}"" y2=""${{l.target.y}}""/>`;for(const n of nodes)html+=`<circle class=""node ${{n.Type==='source'?'node-source':'node-test'}}"" cx=""${{n.x}}"" cy=""${{n.y}}"" r=""8"" data-l=""${{n.Label}}"" data-p=""${{n.FullPath}}""/>`;svg.innerHTML=html;const tip=document.getElementById('tip');svg.querySelectorAll('.node').forEach(n=>{{n.onmouseenter=e=>{{tip.innerHTML=`<strong>${{e.target.dataset.l}}</strong><br><span class=""fp"">${{e.target.dataset.p}}</span>`;tip.style.display='block';tip.style.left=e.pageX+10+'px';tip.style.top=e.pageY+10+'px'}};n.onmouseleave=()=>tip.style.display='none'}})}}
        function initTable(){{const tb=document.querySelector('#t tbody'),sb=document.getElementById('s');function render(f=''){{const fm=M.filter(m=>m.SourceFile.toLowerCase().includes(f)||m.Test.toLowerCase().includes(f));tb.innerHTML=fm.slice(0,100).map(m=>`<tr><td class=""fp"">${{m.SourceFile}}</td><td>${{m.Test}}</td></tr>`).join('');if(fm.length>100)tb.innerHTML+=`<tr><td colspan=""2"" style=""text-align:center;color:var(--text2)"">... 还有 ${{fm.length-100}} 条</td></tr>`}}render();sb.oninput=e=>render(e.target.value.toLowerCase())}}
        initGraph();initTable();window.onresize=initGraph;
    </script>
</body>
</html>";
    }
}

#endregion
