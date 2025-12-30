using System.CommandLine;
using Spectre.Console;
using TiaCC.Core.Services;

namespace TiaCC.Cli;

class Program
{
    static async Task<int> Main(string[] args)
    {
        var rootCommand = new RootCommand("TiaCC - Test Impact Analysis for C/C++");

        // Common options
        var dbOption = new Option<string>(
            aliases: ["--db", "-d"],
            description: "Path to the SQLite database file",
            getDefaultValue: () => "impact_map.db");

        // init command
        var initCommand = new Command("init", "Initialize a new TiaCC database");
        initCommand.AddOption(dbOption);
        initCommand.SetHandler(async (string db) =>
        {
            await ExecuteWithErrorHandling(() => InitCommandAsync(db));
        }, dbOption);

        // scan command
        var scanCommand = new Command("scan", "Scan source files and extract symbols");
        var scanDirOption = new Option<string>(
            aliases: ["--dir", "-D"],
            description: "Directory to scan for source files",
            getDefaultValue: () => ".");
        var patternOption = new Option<string[]>(
            aliases: ["--pattern", "-p"],
            description: "File patterns to include (e.g., *.cpp *.h)",
            getDefaultValue: () => ["*.cpp", "*.c", "*.h", "*.hpp"]);
        scanCommand.AddOption(dbOption);
        scanCommand.AddOption(scanDirOption);
        scanCommand.AddOption(patternOption);
        scanCommand.SetHandler(async (string db, string dir, string[] patterns) =>
        {
            await ExecuteWithErrorHandling(() => ScanCommandAsync(db, dir, patterns));
        }, dbOption, scanDirOption, patternOption);

        // map command
        var mapCommand = new Command("map", "Map coverage data to source files");
        var coverageOption = new Option<string>(
            aliases: ["--coverage", "-c"],
            description: "Path to coverage file (JSON/XML/LCOV)") { IsRequired = true };
        var testNameOption = new Option<string>(
            aliases: ["--test", "-t"],
            description: "Test script name") { IsRequired = true };
        var baseDirOption = new Option<string>(
            aliases: ["--base-dir", "-b"],
            description: "Base directory for resolving file paths",
            getDefaultValue: () => ".");
        mapCommand.AddOption(dbOption);
        mapCommand.AddOption(coverageOption);
        mapCommand.AddOption(testNameOption);
        mapCommand.AddOption(baseDirOption);
        mapCommand.SetHandler(async (string db, string coverage, string test, string baseDir) =>
        {
            await ExecuteWithErrorHandling(() => MapCommandAsync(db, coverage, test, baseDir));
        }, dbOption, coverageOption, testNameOption, baseDirOption);

        // export command
        var exportCommand = new Command("export", "Export data for dashboard visualization");
        var outputOption = new Option<string>(
            aliases: ["--output", "-o"],
            description: "Output directory for JSON files",
            getDefaultValue: () => "./dashboard/data");
        exportCommand.AddOption(dbOption);
        exportCommand.AddOption(outputOption);
        exportCommand.SetHandler(async (string db, string output) =>
        {
            await ExecuteWithErrorHandling(() => ExportCommandAsync(db, output));
        }, dbOption, outputOption);

        // query command
        var queryCommand = new Command("query", "Query affected tests for changed files");
        var filesOption = new Option<string[]>(
            aliases: ["--files", "-f"],
            description: "Changed file paths") { IsRequired = true };
        queryCommand.AddOption(dbOption);
        queryCommand.AddOption(filesOption);
        queryCommand.SetHandler(async (string db, string[] files) =>
        {
            await ExecuteWithErrorHandling(() => QueryCommandAsync(db, files));
        }, dbOption, filesOption);

        // stats command
        var statsCommand = new Command("stats", "Show database statistics");
        statsCommand.AddOption(dbOption);
        statsCommand.SetHandler(async (string db) =>
        {
            await ExecuteWithErrorHandling(() => StatsCommandAsync(db));
        }, dbOption);

        rootCommand.AddCommand(initCommand);
        rootCommand.AddCommand(scanCommand);
        rootCommand.AddCommand(mapCommand);
        rootCommand.AddCommand(exportCommand);
        rootCommand.AddCommand(queryCommand);
        rootCommand.AddCommand(statsCommand);

        return await rootCommand.InvokeAsync(args);
    }

    /// <summary>
    /// Wraps command execution with proper error handling
    /// </summary>
    static async Task ExecuteWithErrorHandling(Func<Task> command)
    {
        try
        {
            await command();
        }
        catch (FileNotFoundException ex)
        {
            AnsiConsole.MarkupLine($"[red]File not found:[/] {ex.FileName ?? ex.Message}");
            Environment.ExitCode = 1;
        }
        catch (DirectoryNotFoundException ex)
        {
            AnsiConsole.MarkupLine($"[red]Directory not found:[/] {ex.Message}");
            Environment.ExitCode = 1;
        }
        catch (UnauthorizedAccessException ex)
        {
            AnsiConsole.MarkupLine($"[red]Access denied:[/] {ex.Message}");
            Environment.ExitCode = 1;
        }
        catch (NotSupportedException ex)
        {
            AnsiConsole.MarkupLine($"[red]Unsupported format:[/] {ex.Message}");
            Environment.ExitCode = 1;
        }
        catch (InvalidOperationException ex)
        {
            AnsiConsole.MarkupLine($"[red]Operation failed:[/] {ex.Message}");
            Environment.ExitCode = 1;
        }
        catch (Exception ex)
        {
            AnsiConsole.MarkupLine($"[red]Unexpected error:[/] {ex.Message}");
#if DEBUG
            AnsiConsole.WriteException(ex);
#endif
            Environment.ExitCode = 1;
        }
    }

    static async Task InitCommandAsync(string dbPath)
    {
        AnsiConsole.MarkupLine($"[cyan]Initializing database:[/] {dbPath}");

        if (File.Exists(dbPath))
        {
            if (!AnsiConsole.Confirm($"Database already exists. Overwrite?", false))
            {
                AnsiConsole.MarkupLine("[yellow]Aborted.[/]");
                return;
            }
            File.Delete(dbPath);
        }

        // Ensure parent directory exists
        var parentDir = Path.GetDirectoryName(dbPath);
        if (!string.IsNullOrEmpty(parentDir) && !Directory.Exists(parentDir))
        {
            Directory.CreateDirectory(parentDir);
        }

        await using var db = new DatabaseService(dbPath);
        await db.InitializeAsync();

        AnsiConsole.MarkupLine("[green]Database initialized successfully.[/]");
    }

    static async Task ScanCommandAsync(string dbPath, string directory, string[] patterns)
    {
        if (!File.Exists(dbPath))
        {
            throw new FileNotFoundException("Database not found. Run 'init' first.", dbPath);
        }

        if (!Directory.Exists(directory))
        {
            throw new DirectoryNotFoundException($"Directory not found: {directory}");
        }

        await using var db = new DatabaseService(dbPath);

        AnsiConsole.MarkupLine($"[cyan]Scanning directory:[/] {directory}");
        AnsiConsole.MarkupLine($"[cyan]Patterns:[/] {string.Join(", ", patterns)}");

        var files = new List<string>();
        foreach (var pattern in patterns)
        {
            try
            {
                files.AddRange(Directory.GetFiles(directory, pattern, SearchOption.AllDirectories));
            }
            catch (UnauthorizedAccessException)
            {
                AnsiConsole.MarkupLine($"[yellow]Warning: Cannot access some directories for pattern {pattern}[/]");
            }
        }

        if (files.Count == 0)
        {
            AnsiConsole.MarkupLine("[yellow]No files found matching the patterns.[/]");
            return;
        }

        await AnsiConsole.Progress()
            .StartAsync(async ctx =>
            {
                var task = ctx.AddTask("[green]Scanning files[/]", maxValue: files.Count);

                foreach (var file in files)
                {
                    var relativePath = Path.GetRelativePath(directory, file).Replace('\\', '/');
                    await db.GetOrCreateSourceFileAsync(relativePath);
                    task.Increment(1);
                }
            });

        AnsiConsole.MarkupLine($"[green]Scanned {files.Count} files.[/]");
    }

    static async Task MapCommandAsync(string dbPath, string coveragePath, string testName, string baseDir)
    {
        if (!File.Exists(dbPath))
        {
            throw new FileNotFoundException("Database not found. Run 'init' first.", dbPath);
        }

        if (!File.Exists(coveragePath))
        {
            throw new FileNotFoundException("Coverage file not found.", coveragePath);
        }

        await using var db = new DatabaseService(dbPath);

        AnsiConsole.MarkupLine($"[cyan]Parsing coverage:[/] {coveragePath}");
        AnsiConsole.MarkupLine($"[cyan]Test name:[/] {testName}");

        var coverage = CoverageParser.Parse(coveragePath, baseDir);

        if (coverage.Files.Count == 0 && coverage.Functions.Count == 0)
        {
            AnsiConsole.MarkupLine("[yellow]No coverage data found in the file.[/]");
            return;
        }

        var testScript = await db.GetOrCreateTestScriptAsync(testName);

        await AnsiConsole.Progress()
            .StartAsync(async ctx =>
            {
                var task = ctx.AddTask("[green]Mapping coverage[/]", maxValue: coverage.Files.Count);

                foreach (var (filePath, fileCov) in coverage.Files)
                {
                    var sourceFile = await db.GetOrCreateSourceFileAsync(filePath);
                    await db.UpsertCoverageMapAsync(sourceFile.Id, testScript.Id, fileCov.CoveragePercent);
                    task.Increment(1);
                }

                // Map functions
                if (coverage.Functions.Count > 0)
                {
                    var funcTask = ctx.AddTask("[green]Mapping functions[/]", maxValue: coverage.Functions.Count);
                    foreach (var func in coverage.Functions)
                    {
                        var sourceFile = await db.GetOrCreateSourceFileAsync(func.FilePath);
                        var symbol = await db.GetOrCreateSymbolAsync(
                            sourceFile.Id, func.Name, "function", func.StartLine, func.EndLine);

                        // Use execution count for more accurate coverage
                        var funcCoverage = func.ExecutionCount > 0
                            ? Math.Min(100.0, func.ExecutionCount)
                            : 0.0;
                        await db.UpsertSymbolCoverageAsync(symbol.Id, testScript.Id, funcCoverage);
                        funcTask.Increment(1);
                    }
                }
            });

        AnsiConsole.MarkupLine($"[green]Mapped {coverage.Files.Count} files and {coverage.Functions.Count} functions.[/]");
    }

    static async Task ExportCommandAsync(string dbPath, string outputDir)
    {
        if (!File.Exists(dbPath))
        {
            throw new FileNotFoundException("Database not found.", dbPath);
        }

        // Ensure output directory exists
        if (!Directory.Exists(outputDir))
        {
            Directory.CreateDirectory(outputDir);
        }

        await using var db = new DatabaseService(dbPath);
        var exportService = new ExportService(db);

        AnsiConsole.MarkupLine($"[cyan]Exporting to:[/] {outputDir}");

        await AnsiConsole.Status()
            .StartAsync("Exporting data...", async ctx =>
            {
                await exportService.ExportAllAsync(outputDir);
            });

        AnsiConsole.MarkupLine("[green]Export completed.[/]");
        AnsiConsole.MarkupLine($"[dim]Files written to {Path.GetFullPath(outputDir)}[/]");
    }

    static async Task QueryCommandAsync(string dbPath, string[] files)
    {
        if (!File.Exists(dbPath))
        {
            throw new FileNotFoundException("Database not found.", dbPath);
        }

        if (files.Length == 0)
        {
            AnsiConsole.MarkupLine("[yellow]No files specified.[/]");
            return;
        }

        await using var db = new DatabaseService(dbPath);

        var allTests = new HashSet<string>();

        foreach (var file in files)
        {
            var normalizedPath = file.Replace('\\', '/');
            var tests = await db.GetTestsForSourceFileAsync(normalizedPath);
            foreach (var test in tests ?? [])
            {
                allTests.Add(test.ScriptPath);
            }
        }

        if (allTests.Count == 0)
        {
            Console.WriteLine("No affected tests found.");
            return;
        }

        AnsiConsole.MarkupLine($"[green]Affected tests ({allTests.Count}):[/]");
        foreach (var test in allTests.OrderBy(t => t))
        {
            AnsiConsole.MarkupLine($"  [cyan]{test}[/]");
        }

        // Also output as plain text for CI/CD integration
        Console.WriteLine();
        foreach (var test in allTests.OrderBy(t => t))
        {
            Console.WriteLine(test);
        }
    }

    static async Task StatsCommandAsync(string dbPath)
    {
        if (!File.Exists(dbPath))
        {
            throw new FileNotFoundException("Database not found.", dbPath);
        }

        await using var db = new DatabaseService(dbPath);
        var stats = await db.GetStatsAsync();

        var table = new Table();
        table.AddColumn("Metric");
        table.AddColumn("Value");

        table.AddRow("Source Files", stats.SourceFileCount.ToString());
        table.AddRow("Test Scripts", stats.TestScriptCount.ToString());
        table.AddRow("Mappings", stats.MappingCount.ToString());
        table.AddRow("Symbols", stats.SymbolCount.ToString());
        table.AddRow("Avg Coverage", $"{stats.AverageCoverage:F1}%");

        AnsiConsole.Write(table);

        // Directory coverage
        var dirCoverage = await db.GetCoverageByDirectoryAsync();
        if (dirCoverage.Count > 0)
        {
            AnsiConsole.WriteLine();
            AnsiConsole.MarkupLine("[cyan]Coverage by Directory:[/]");

            var dirTable = new Table();
            dirTable.AddColumn("Directory");
            dirTable.AddColumn("Files");
            dirTable.AddColumn("Tests");
            dirTable.AddColumn("Coverage");

            foreach (var dir in dirCoverage)
            {
                var color = dir.AvgCoverage >= 80 ? "green" : dir.AvgCoverage >= 50 ? "yellow" : "red";
                dirTable.AddRow(
                    dir.Directory,
                    dir.FileCount.ToString(),
                    dir.TestCount.ToString(),
                    $"[{color}]{dir.AvgCoverage:F1}%[/]");
            }

            AnsiConsole.Write(dirTable);
        }
    }
}
