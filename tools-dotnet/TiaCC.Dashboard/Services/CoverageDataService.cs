using System.Net.Http.Json;
using TiaCC.Dashboard.Models;

namespace TiaCC.Dashboard.Services;

public class CoverageDataService
{
    private readonly HttpClient _httpClient;
    private DashboardData? _data;
    private Dictionary<int, SourceFileInfo>? _sourceFileMap;
    private Dictionary<int, TestScriptInfo>? _testScriptMap;
    private Dictionary<int, double>? _fileCoverageMap;

    public CoverageDataService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<DashboardData> LoadDataAsync()
    {
        if (_data != null) return _data;

        _data = await _httpClient.GetFromJsonAsync<DashboardData>("data/dashboard.json")
            ?? new DashboardData();

        _sourceFileMap = _data.SourceFiles.ToDictionary(f => f.Id);
        _testScriptMap = _data.TestScripts.ToDictionary(t => t.Id);

        // Calculate average coverage per file
        _fileCoverageMap = _data.CoverageMap
            .GroupBy(c => c.SourceFileId)
            .ToDictionary(
                g => g.Key,
                g => g.Average(c => c.CoveragePercentage)
            );

        return _data;
    }

    public SourceFileInfo? GetSourceFile(int id) =>
        _sourceFileMap?.GetValueOrDefault(id);

    public TestScriptInfo? GetTestScript(int id) =>
        _testScriptMap?.GetValueOrDefault(id);

    public double GetFileCoverage(int fileId) =>
        _fileCoverageMap?.GetValueOrDefault(fileId) ?? 0;

    public List<ModuleCoverage> GetModuleCoverages()
    {
        if (_data == null) return [];

        var filesByModule = _data.SourceFiles
            .GroupBy(f => GetModuleName(f.Path))
            .OrderBy(g => g.Key);

        var result = new List<ModuleCoverage>();

        foreach (var group in filesByModule)
        {
            var files = group.ToList();
            var fileCoverages = files.Select(f => new FileCoverage
            {
                FileName = Path.GetFileName(f.Path),
                FullPath = f.Path,
                Coverage = GetFileCoverage(f.Id),
                TestCount = _data.CoverageMap.Count(c => c.SourceFileId == f.Id),
                Tests = _data.CoverageMap
                    .Where(c => c.SourceFileId == f.Id)
                    .Select(c => GetTestScript(c.TestScriptId)?.Name ?? "Unknown")
                    .ToList()
            }).ToList();

            result.Add(new ModuleCoverage
            {
                ModuleName = group.Key,
                FileCount = files.Count,
                CoveredFiles = fileCoverages.Count(f => f.Coverage > 0),
                AverageCoverage = fileCoverages.Count > 0
                    ? fileCoverages.Average(f => f.Coverage)
                    : 0,
                Files = fileCoverages
            });
        }

        return result;
    }

    public TreemapNode BuildTreemap(string? rootPath = null)
    {
        if (_data == null) return new TreemapNode { Name = "root" };

        var root = new TreemapNode
        {
            Name = rootPath ?? "root",
            FullPath = rootPath ?? "",
            IsDirectory = true
        };

        var files = _data.SourceFiles.AsEnumerable();

        if (!string.IsNullOrEmpty(rootPath))
        {
            files = files.Where(f => f.Path.StartsWith(rootPath + "/") || f.Path.StartsWith(rootPath + "\\"));
        }

        foreach (var file in files)
        {
            var relativePath = string.IsNullOrEmpty(rootPath)
                ? file.Path
                : file.Path[(rootPath.Length + 1)..];

            AddToTreemap(root, relativePath, file.Path, GetFileCoverage(file.Id));
        }

        CalculateTreemapValues(root);
        return root;
    }

    private void AddToTreemap(TreemapNode parent, string relativePath, string fullPath, double coverage)
    {
        var parts = relativePath.Split(['/', '\\'], 2);
        var name = parts[0];

        if (parts.Length == 1)
        {
            // This is a file
            parent.Children.Add(new TreemapNode
            {
                Name = name,
                FullPath = fullPath,
                Value = 1,
                Coverage = coverage,
                IsDirectory = false
            });
        }
        else
        {
            // This is a directory
            var dir = parent.Children.FirstOrDefault(c => c.Name == name && c.IsDirectory);
            if (dir == null)
            {
                dir = new TreemapNode
                {
                    Name = name,
                    FullPath = string.IsNullOrEmpty(parent.FullPath) ? name : $"{parent.FullPath}/{name}",
                    IsDirectory = true
                };
                parent.Children.Add(dir);
            }
            AddToTreemap(dir, parts[1], fullPath, coverage);
        }
    }

    private void CalculateTreemapValues(TreemapNode node)
    {
        if (!node.IsDirectory) return;

        foreach (var child in node.Children)
        {
            CalculateTreemapValues(child);
        }

        node.Value = node.Children.Sum(c => c.Value);
        node.Coverage = node.Children.Count > 0
            ? node.Children.Average(c => c.Coverage)
            : 0;
    }

    public FileTreeNode BuildFileTree()
    {
        if (_data == null) return new FileTreeNode { Name = "root", IsDirectory = true };

        var root = new FileTreeNode { Name = "root", IsDirectory = true };

        foreach (var file in _data.SourceFiles.OrderBy(f => f.Path))
        {
            AddToFileTree(root, file.Path, GetFileCoverage(file.Id));
        }

        return root;
    }

    private void AddToFileTree(FileTreeNode parent, string path, double coverage)
    {
        var parts = path.Split(['/', '\\'], 2);
        var name = parts[0];

        if (parts.Length == 1)
        {
            parent.Children.Add(new FileTreeNode
            {
                Name = name,
                FullPath = path,
                IsDirectory = false,
                Coverage = coverage
            });
        }
        else
        {
            var dir = parent.Children.FirstOrDefault(c => c.Name == name && c.IsDirectory);
            if (dir == null)
            {
                dir = new FileTreeNode
                {
                    Name = name,
                    FullPath = name,
                    IsDirectory = true
                };
                parent.Children.Add(dir);
            }
            AddToFileTree(dir, parts[1], coverage);
        }
    }

    public List<FileCoverage> Search(string query)
    {
        if (_data == null || string.IsNullOrWhiteSpace(query)) return [];

        var lowerQuery = query.ToLowerInvariant();

        return _data.SourceFiles
            .Where(f => f.Path.ToLowerInvariant().Contains(lowerQuery))
            .Select(f => new FileCoverage
            {
                FileName = Path.GetFileName(f.Path),
                FullPath = f.Path,
                Coverage = GetFileCoverage(f.Id),
                TestCount = _data.CoverageMap.Count(c => c.SourceFileId == f.Id),
                Tests = _data.CoverageMap
                    .Where(c => c.SourceFileId == f.Id)
                    .Select(c => GetTestScript(c.TestScriptId)?.Name ?? "Unknown")
                    .ToList()
            })
            .OrderByDescending(f => f.Coverage)
            .Take(50)
            .ToList();
    }

    public (int totalFiles, int coveredFiles, double avgCoverage, int totalTests) GetStatistics()
    {
        if (_data == null) return (0, 0, 0, 0);

        var totalFiles = _data.SourceFiles.Count;
        var coveredFiles = _fileCoverageMap?.Count(kvp => kvp.Value > 0) ?? 0;
        var avgCoverage = _fileCoverageMap?.Values.DefaultIfEmpty(0).Average() ?? 0;
        var totalTests = _data.TestScripts.Count;

        return (totalFiles, coveredFiles, avgCoverage, totalTests);
    }

    private static string GetModuleName(string path)
    {
        var parts = path.Split(['/', '\\']);
        return parts.Length > 1 ? parts[0] : "(root)";
    }
}
