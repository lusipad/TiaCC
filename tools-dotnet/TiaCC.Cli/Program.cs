using System.CommandLine;
using Spectre.Console;
using TiaCC.Core.Models;
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
            description: "File patterns to include (e.g., *.cs *.cpp *.h)",
            getDefaultValue: () => ["*.cs", "*.cpp", "*.c", "*.h", "*.hpp"]);
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

        // recommend command
        var recommendCommand = new Command("recommend", "Recommend tests based on Git changes");
        var baseRefOption = new Option<string?>(
            aliases: ["--base", "-B"],
            description: "Base Git ref for comparison (default: auto-detect)");
        var headRefOption = new Option<string?>(
            aliases: ["--head", "-H"],
            description: "Head Git ref for comparison (default: current)");
        var uncommittedOption = new Option<bool>(
            aliases: ["--uncommitted", "-u"],
            description: "Include uncommitted changes",
            getDefaultValue: () => true);
        var formatOption = new Option<string>(
            aliases: ["--format", "-F"],
            description: "Output format (list, json, ci)",
            getDefaultValue: () => "list");
        recommendCommand.AddOption(dbOption);
        recommendCommand.AddOption(baseRefOption);
        recommendCommand.AddOption(headRefOption);
        recommendCommand.AddOption(uncommittedOption);
        recommendCommand.AddOption(formatOption);
        recommendCommand.SetHandler(async (string db, string? baseRef, string? headRef, bool uncommitted, string format) =>
        {
            await ExecuteWithErrorHandling(() => RecommendCommandAsync(db, baseRef, headRef, uncommitted, format));
        }, dbOption, baseRefOption, headRefOption, uncommittedOption, formatOption);

        // run command
        var runCommand = new Command("run", "Run affected tests based on Git changes");
        var runnerOption = new Option<string>(
            aliases: ["--runner", "-r"],
            description: "Test runner command (e.g., dotnet test, pytest, npm test)",
            getDefaultValue: () => "dotnet test");
        var argsOption = new Option<string?>(
            aliases: ["--args", "-a"],
            description: "Additional arguments to pass to the test runner");
        var dryRunOption = new Option<bool>(
            aliases: ["--dry-run"],
            description: "Show what would be run without executing",
            getDefaultValue: () => false);
        runCommand.AddOption(dbOption);
        runCommand.AddOption(baseRefOption);
        runCommand.AddOption(headRefOption);
        runCommand.AddOption(uncommittedOption);
        runCommand.AddOption(runnerOption);
        runCommand.AddOption(argsOption);
        runCommand.AddOption(dryRunOption);
        runCommand.SetHandler(async (string db, string? baseRef, string? headRef, bool uncommitted, string runner, string? extraArgs, bool dryRun) =>
        {
            await ExecuteWithErrorHandling(() => RunCommandAsync(db, baseRef, headRef, uncommitted, runner, extraArgs, dryRun));
        }, dbOption, baseRefOption, headRefOption, uncommittedOption, runnerOption, argsOption, dryRunOption);

        // config command
        var configCommand = new Command("config", "Manage TiaCC configuration");

        var configInitCommand = new Command("init", "Initialize configuration file");
        var configPathOption = new Option<string?>(
            aliases: ["--path", "-p"],
            description: "Path for config file (default: .tiacc/config.json)");
        configInitCommand.AddOption(configPathOption);
        configInitCommand.SetHandler(async (string? path) =>
        {
            await ExecuteWithErrorHandling(() => ConfigInitCommandAsync(path));
        }, configPathOption);

        var configShowCommand = new Command("show", "Show current configuration");
        configShowCommand.SetHandler(async () =>
        {
            await ExecuteWithErrorHandling(() => ConfigShowCommandAsync());
        });

        configCommand.AddCommand(configInitCommand);
        configCommand.AddCommand(configShowCommand);

        // split command
        var splitCommand = new Command("split", "Split tests into groups for parallel execution");
        var splitCountOption = new Option<int>(
            aliases: ["--count", "-n"],
            description: "Number of groups to split into",
            getDefaultValue: () => 4);
        var splitIndexOption = new Option<int?>(
            aliases: ["--index", "-i"],
            description: "Return only the Nth group (0-based)");
        var splitModeOption = new Option<string>(
            aliases: ["--mode", "-m"],
            description: "Split mode: round-robin, balanced, or random",
            getDefaultValue: () => "round-robin");
        splitCommand.AddOption(dbOption);
        splitCommand.AddOption(baseRefOption);
        splitCommand.AddOption(headRefOption);
        splitCommand.AddOption(uncommittedOption);
        splitCommand.AddOption(splitCountOption);
        splitCommand.AddOption(splitIndexOption);
        splitCommand.AddOption(splitModeOption);
        splitCommand.AddOption(formatOption);
        splitCommand.SetHandler(async (string db, string? baseRef, string? headRef, bool uncommitted, int count, int? index, string mode, string format) =>
        {
            await ExecuteWithErrorHandling(() => SplitCommandAsync(db, baseRef, headRef, uncommitted, count, index, mode, format));
        }, dbOption, baseRefOption, headRefOption, uncommittedOption, splitCountOption, splitIndexOption, splitModeOption, formatOption);

        rootCommand.AddCommand(initCommand);
        rootCommand.AddCommand(scanCommand);
        rootCommand.AddCommand(mapCommand);
        rootCommand.AddCommand(exportCommand);
        rootCommand.AddCommand(queryCommand);
        rootCommand.AddCommand(statsCommand);
        rootCommand.AddCommand(recommendCommand);
        rootCommand.AddCommand(runCommand);
        rootCommand.AddCommand(configCommand);
        rootCommand.AddCommand(splitCommand);

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

        var symbolExtractor = new SymbolExtractor();
        var totalSymbols = 0;

        await AnsiConsole.Progress()
            .StartAsync(async ctx =>
            {
                var fileTask = ctx.AddTask("[green]Scanning files[/]", maxValue: files.Count);
                var symbolTask = ctx.AddTask("[cyan]Extracting symbols[/]", maxValue: files.Count);

                foreach (var file in files)
                {
                    var relativePath = Path.GetRelativePath(directory, file).Replace('\\', '/');
                    var sourceFile = await db.GetOrCreateSourceFileAsync(relativePath);
                    fileTask.Increment(1);

                    // Extract symbols for C# files
                    var extension = Path.GetExtension(file).ToLowerInvariant();
                    if (extension == ".cs")
                    {
                        var symbols = symbolExtractor.ExtractFromCSharp(file);
                        foreach (var symbol in symbols)
                        {
                            await db.GetOrCreateSymbolAsync(
                                sourceFile.Id,
                                symbol.Name,
                                symbol.SymbolType,
                                symbol.StartLine,
                                symbol.EndLine);
                            totalSymbols++;
                        }
                    }
                    symbolTask.Increment(1);
                }
            });

        AnsiConsole.MarkupLine($"[green]Scanned {files.Count} files, extracted {totalSymbols} symbols.[/]");
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

    static async Task RecommendCommandAsync(string dbPath, string? baseRef, string? headRef, bool includeUncommitted, string format)
    {
        if (!File.Exists(dbPath))
        {
            throw new FileNotFoundException("Database not found. Run 'init' and 'map' first.", dbPath);
        }

        var gitService = new GitService();

        if (!gitService.IsGitRepository())
        {
            throw new InvalidOperationException("Not a Git repository. The recommend command requires Git.");
        }

        // Collect changed files
        var changedFiles = new HashSet<string>();

        // Include uncommitted changes if requested
        if (includeUncommitted)
        {
            foreach (var file in gitService.GetUncommittedChanges())
            {
                changedFiles.Add(file);
            }
        }

        // Get changes between refs
        if (!string.IsNullOrEmpty(baseRef))
        {
            foreach (var file in gitService.GetChangedFiles(baseRef, headRef))
            {
                changedFiles.Add(file);
            }
        }
        else if (!includeUncommitted)
        {
            // Default: changes in last commit
            foreach (var file in gitService.GetChangedFilesInLastCommits(1))
            {
                changedFiles.Add(file);
            }
        }

        if (changedFiles.Count == 0)
        {
            AnsiConsole.MarkupLine("[yellow]No changed files detected.[/]");
            return;
        }

        AnsiConsole.MarkupLine($"[cyan]Changed files ({changedFiles.Count}):[/]");
        foreach (var file in changedFiles.Take(10))
        {
            AnsiConsole.MarkupLine($"  [dim]{file}[/]");
        }
        if (changedFiles.Count > 10)
        {
            AnsiConsole.MarkupLine($"  [dim]... and {changedFiles.Count - 10} more[/]");
        }

        await using var db = new DatabaseService(dbPath);

        var affectedTests = new HashSet<string>();
        foreach (var file in changedFiles)
        {
            var tests = await db.GetTestsForSourceFileAsync(file);
            foreach (var test in tests)
            {
                affectedTests.Add(test.ScriptPath);
            }
        }

        if (affectedTests.Count == 0)
        {
            AnsiConsole.MarkupLine("[yellow]No affected tests found for the changed files.[/]");
            return;
        }

        // Output based on format
        switch (format.ToLowerInvariant())
        {
            case "json":
                var json = System.Text.Json.JsonSerializer.Serialize(new
                {
                    changedFiles = changedFiles.ToList(),
                    affectedTests = affectedTests.OrderBy(t => t).ToList()
                }, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
                Console.WriteLine(json);
                break;

            case "ci":
                // CI-friendly output: just test names, one per line
                foreach (var test in affectedTests.OrderBy(t => t))
                {
                    Console.WriteLine(test);
                }
                break;

            default: // "list"
                AnsiConsole.WriteLine();
                AnsiConsole.MarkupLine($"[green]Recommended tests ({affectedTests.Count}):[/]");
                var table = new Table();
                table.AddColumn("Test Script");
                foreach (var test in affectedTests.OrderBy(t => t))
                {
                    table.AddRow($"[cyan]{test}[/]");
                }
                AnsiConsole.Write(table);
                break;
        }
    }

    static async Task RunCommandAsync(string dbPath, string? baseRef, string? headRef, bool includeUncommitted, string runner, string? extraArgs, bool dryRun)
    {
        if (!File.Exists(dbPath))
        {
            throw new FileNotFoundException("Database not found. Run 'init' and 'map' first.", dbPath);
        }

        var gitService = new GitService();

        if (!gitService.IsGitRepository())
        {
            throw new InvalidOperationException("Not a Git repository. The run command requires Git.");
        }

        // Collect changed files
        var changedFiles = new HashSet<string>();

        if (includeUncommitted)
        {
            foreach (var file in gitService.GetUncommittedChanges())
            {
                changedFiles.Add(file);
            }
        }

        if (!string.IsNullOrEmpty(baseRef))
        {
            foreach (var file in gitService.GetChangedFiles(baseRef, headRef))
            {
                changedFiles.Add(file);
            }
        }
        else if (!includeUncommitted)
        {
            foreach (var file in gitService.GetChangedFilesInLastCommits(1))
            {
                changedFiles.Add(file);
            }
        }

        if (changedFiles.Count == 0)
        {
            AnsiConsole.MarkupLine("[yellow]No changed files detected. Skipping tests.[/]");
            return;
        }

        await using var db = new DatabaseService(dbPath);

        var affectedTests = new HashSet<string>();
        foreach (var file in changedFiles)
        {
            var tests = await db.GetTestsForSourceFileAsync(file);
            foreach (var test in tests)
            {
                affectedTests.Add(test.ScriptPath);
            }
        }

        if (affectedTests.Count == 0)
        {
            AnsiConsole.MarkupLine("[yellow]No affected tests found. Skipping test run.[/]");
            return;
        }

        AnsiConsole.MarkupLine($"[cyan]Changed files:[/] {changedFiles.Count}");
        AnsiConsole.MarkupLine($"[cyan]Affected tests:[/] {affectedTests.Count}");
        AnsiConsole.WriteLine();

        // Build the test filter
        var testFilter = BuildTestFilter(runner, affectedTests);
        var fullCommand = $"{runner} {testFilter}";
        if (!string.IsNullOrEmpty(extraArgs))
        {
            fullCommand += $" {extraArgs}";
        }

        if (dryRun)
        {
            AnsiConsole.MarkupLine("[yellow]Dry run mode - would execute:[/]");
            AnsiConsole.MarkupLine($"[dim]{fullCommand}[/]");
            return;
        }

        AnsiConsole.MarkupLine($"[green]Running:[/] {fullCommand}");
        AnsiConsole.WriteLine();

        // Execute the test runner
        using var process = new System.Diagnostics.Process
        {
            StartInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = GetShell(),
                Arguments = GetShellArgs(fullCommand),
                UseShellExecute = false,
                CreateNoWindow = false
            }
        };

        process.Start();
        await process.WaitForExitAsync();

        Environment.ExitCode = process.ExitCode;

        if (process.ExitCode == 0)
        {
            AnsiConsole.MarkupLine("[green]Tests passed![/]");
        }
        else
        {
            AnsiConsole.MarkupLine($"[red]Tests failed with exit code {process.ExitCode}[/]");
        }
    }

    static string BuildTestFilter(string runner, HashSet<string> tests)
    {
        // Build appropriate filter based on test runner
        if (runner.Contains("dotnet"))
        {
            // For dotnet test, use --filter
            var filter = string.Join("|", tests.Select(t => Path.GetFileNameWithoutExtension(t)));
            return $"--filter \"{filter}\"";
        }
        else if (runner.Contains("pytest"))
        {
            // For pytest, list test files
            return string.Join(" ", tests.Select(t => $"\"{t}\""));
        }
        else if (runner.Contains("npm") || runner.Contains("jest"))
        {
            // For Jest/npm, use --testPathPattern
            var pattern = string.Join("|", tests.Select(t => Path.GetFileName(t)));
            return $"--testPathPattern=\"{pattern}\"";
        }
        else
        {
            // Generic: just list the test files
            return string.Join(" ", tests.Select(t => $"\"{t}\""));
        }
    }

    static string GetShell()
    {
        return OperatingSystem.IsWindows() ? "cmd.exe" : "/bin/sh";
    }

    static string GetShellArgs(string command)
    {
        return OperatingSystem.IsWindows() ? $"/c {command}" : $"-c \"{command.Replace("\"", "\\\"")}\"";
    }

    static Task ConfigInitCommandAsync(string? configPath)
    {
        var path = configPath ?? TiaCCConfig.GetDefaultPath(Directory.GetCurrentDirectory());

        if (File.Exists(path))
        {
            if (!AnsiConsole.Confirm($"Configuration file already exists at {path}. Overwrite?", false))
            {
                AnsiConsole.MarkupLine("[yellow]Aborted.[/]");
                return Task.CompletedTask;
            }
        }

        var config = new TiaCCConfig();
        config.Save(path);

        AnsiConsole.MarkupLine($"[green]Configuration file created:[/] {path}");
        AnsiConsole.MarkupLine("[dim]Edit this file to customize TiaCC behavior.[/]");

        return Task.CompletedTask;
    }

    static Task ConfigShowCommandAsync()
    {
        var configPath = TiaCCConfig.FindConfigFile(Directory.GetCurrentDirectory());

        if (configPath == null)
        {
            AnsiConsole.MarkupLine("[yellow]No configuration file found.[/]");
            AnsiConsole.MarkupLine("[dim]Run 'tiacc config init' to create one.[/]");
            return Task.CompletedTask;
        }

        AnsiConsole.MarkupLine($"[cyan]Configuration file:[/] {configPath}");
        AnsiConsole.WriteLine();

        var config = TiaCCConfig.Load(configPath);

        var tree = new Tree("[bold]TiaCC Configuration[/]");

        // Database
        tree.AddNode($"[cyan]Database:[/] {config.Database}");

        // Source patterns
        var patternsNode = tree.AddNode("[cyan]Source Patterns[/]");
        foreach (var pattern in config.SourcePatterns)
        {
            patternsNode.AddNode($"[dim]{pattern}[/]");
        }

        // Exclude dirs
        var excludeNode = tree.AddNode("[cyan]Exclude Directories[/]");
        foreach (var dir in config.ExcludeDirs)
        {
            excludeNode.AddNode($"[dim]{dir}[/]");
        }

        // Test runner
        var runnerNode = tree.AddNode("[cyan]Test Runner[/]");
        runnerNode.AddNode($"Command: {config.TestRunner.Command}");
        if (!string.IsNullOrEmpty(config.TestRunner.Args))
            runnerNode.AddNode($"Args: {config.TestRunner.Args}");
        if (!string.IsNullOrEmpty(config.TestRunner.WorkingDir))
            runnerNode.AddNode($"Working Dir: {config.TestRunner.WorkingDir}");

        // Coverage
        var coverageNode = tree.AddNode("[cyan]Coverage[/]");
        coverageNode.AddNode($"Format: {config.Coverage.Format}");
        coverageNode.AddNode($"Path: {config.Coverage.Path}");
        coverageNode.AddNode($"Pattern: {config.Coverage.Pattern}");

        // Git
        var gitNode = tree.AddNode("[cyan]Git[/]");
        gitNode.AddNode($"Base Branch: {config.Git.BaseBranch}");
        gitNode.AddNode($"Include Uncommitted: {config.Git.IncludeUncommitted}");

        // Dashboard
        var dashNode = tree.AddNode("[cyan]Dashboard[/]");
        dashNode.AddNode($"Output Dir: {config.Dashboard.OutputDir}");
        dashNode.AddNode($"Format: {config.Dashboard.Format}");

        AnsiConsole.Write(tree);

        return Task.CompletedTask;
    }

    static async Task SplitCommandAsync(string dbPath, string? baseRef, string? headRef, bool includeUncommitted, int groupCount, int? groupIndex, string mode, string format)
    {
        if (!File.Exists(dbPath))
        {
            throw new FileNotFoundException("Database not found. Run 'init' and 'map' first.", dbPath);
        }

        if (groupCount < 1)
        {
            throw new ArgumentException("Group count must be at least 1.");
        }

        var gitService = new GitService();

        if (!gitService.IsGitRepository())
        {
            throw new InvalidOperationException("Not a Git repository. The split command requires Git.");
        }

        // Collect changed files (same logic as recommend)
        var changedFiles = new HashSet<string>();

        if (includeUncommitted)
        {
            foreach (var file in gitService.GetUncommittedChanges())
            {
                changedFiles.Add(file);
            }
        }

        if (!string.IsNullOrEmpty(baseRef))
        {
            foreach (var file in gitService.GetChangedFiles(baseRef, headRef))
            {
                changedFiles.Add(file);
            }
        }
        else if (!includeUncommitted)
        {
            foreach (var file in gitService.GetChangedFilesInLastCommits(1))
            {
                changedFiles.Add(file);
            }
        }

        await using var db = new DatabaseService(dbPath);

        var affectedTests = new HashSet<string>();
        foreach (var file in changedFiles)
        {
            var tests = await db.GetTestsForSourceFileAsync(file);
            foreach (var test in tests)
            {
                affectedTests.Add(test.ScriptPath);
            }
        }

        if (affectedTests.Count == 0)
        {
            AnsiConsole.MarkupLine("[yellow]No affected tests found.[/]");
            return;
        }

        // Sort tests for consistent splitting
        var sortedTests = affectedTests.OrderBy(t => t).ToList();

        // Split tests into groups
        var groups = SplitTests(sortedTests, groupCount, mode);

        // Output based on format and index
        if (groupIndex.HasValue)
        {
            if (groupIndex.Value < 0 || groupIndex.Value >= groupCount)
            {
                throw new ArgumentException($"Group index must be between 0 and {groupCount - 1}.");
            }

            var selectedGroup = groups[groupIndex.Value];
            OutputTestList(selectedGroup, format);
        }
        else
        {
            // Output all groups
            switch (format.ToLowerInvariant())
            {
                case "json":
                    var json = System.Text.Json.JsonSerializer.Serialize(
                        groups.Select((g, i) => new { group = i, tests = g }).ToList(),
                        new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
                    Console.WriteLine(json);
                    break;

                default:
                    AnsiConsole.MarkupLine($"[green]Split {affectedTests.Count} tests into {groupCount} groups:[/]");
                    AnsiConsole.WriteLine();

                    for (var i = 0; i < groups.Count; i++)
                    {
                        AnsiConsole.MarkupLine($"[cyan]Group {i}[/] ({groups[i].Count} tests):");
                        foreach (var test in groups[i])
                        {
                            AnsiConsole.MarkupLine($"  [dim]{test}[/]");
                        }
                        AnsiConsole.WriteLine();
                    }
                    break;
            }
        }
    }

    static List<List<string>> SplitTests(List<string> tests, int groupCount, string mode)
    {
        var groups = Enumerable.Range(0, groupCount).Select(_ => new List<string>()).ToList();

        switch (mode.ToLowerInvariant())
        {
            case "random":
                var random = new Random();
                var shuffled = tests.OrderBy(_ => random.Next()).ToList();
                for (var i = 0; i < shuffled.Count; i++)
                {
                    groups[i % groupCount].Add(shuffled[i]);
                }
                break;

            case "balanced":
                // Try to balance by test name length (proxy for complexity)
                var byLength = tests.OrderByDescending(t => t.Length).ToList();
                var groupSizes = new int[groupCount];
                foreach (var test in byLength)
                {
                    var minGroup = Array.IndexOf(groupSizes, groupSizes.Min());
                    groups[minGroup].Add(test);
                    groupSizes[minGroup] += test.Length;
                }
                break;

            default: // round-robin
                for (var i = 0; i < tests.Count; i++)
                {
                    groups[i % groupCount].Add(tests[i]);
                }
                break;
        }

        return groups;
    }

    static void OutputTestList(List<string> tests, string format)
    {
        switch (format.ToLowerInvariant())
        {
            case "json":
                var json = System.Text.Json.JsonSerializer.Serialize(tests,
                    new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
                Console.WriteLine(json);
                break;

            case "ci":
                foreach (var test in tests)
                {
                    Console.WriteLine(test);
                }
                break;

            default:
                foreach (var test in tests)
                {
                    AnsiConsole.MarkupLine($"[cyan]{test}[/]");
                }
                break;
        }
    }
}
