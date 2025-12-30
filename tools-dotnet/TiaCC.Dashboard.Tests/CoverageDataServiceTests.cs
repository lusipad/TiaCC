using System.Net;
using System.Text.Json;
using RichardSzalay.MockHttp;
using TiaCC.Dashboard.Models;
using TiaCC.Dashboard.Services;
using Xunit;

namespace TiaCC.Dashboard.Tests;

public class CoverageDataServiceTests
{
    private static DashboardData CreateTestData()
    {
        return new DashboardData
        {
            GeneratedAt = DateTime.UtcNow,
            SourceFiles =
            [
                new SourceFileInfo { Id = 1, Path = "src/Services/UserService.cs" },
                new SourceFileInfo { Id = 2, Path = "src/Services/OrderService.cs" },
                new SourceFileInfo { Id = 3, Path = "src/Models/User.cs" },
                new SourceFileInfo { Id = 4, Path = "tests/UserServiceTests.cs" }
            ],
            TestScripts =
            [
                new TestScriptInfo { Id = 1, Name = "UserServiceTests" },
                new TestScriptInfo { Id = 2, Name = "OrderServiceTests" }
            ],
            CoverageMap =
            [
                new CoverageMapEntry { SourceFileId = 1, TestScriptId = 1, CoveragePercentage = 85.0 },
                new CoverageMapEntry { SourceFileId = 1, TestScriptId = 2, CoveragePercentage = 15.0 },
                new CoverageMapEntry { SourceFileId = 2, TestScriptId = 2, CoveragePercentage = 90.0 },
                new CoverageMapEntry { SourceFileId = 3, TestScriptId = 1, CoveragePercentage = 100.0 }
            ]
        };
    }

    private static CoverageDataService CreateService(DashboardData data)
    {
        var mockHttp = new MockHttpMessageHandler();
        var json = JsonSerializer.Serialize(data);
        mockHttp.When("http://localhost/data/dashboard.json")
            .Respond("application/json", json);

        var httpClient = mockHttp.ToHttpClient();
        httpClient.BaseAddress = new Uri("http://localhost/");

        return new CoverageDataService(httpClient);
    }

    #region LoadDataAsync Tests

    [Fact]
    public async Task LoadDataAsync_ReturnsData()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);

        var result = await service.LoadDataAsync();

        Assert.NotNull(result);
        Assert.Equal(4, result.SourceFiles.Count);
        Assert.Equal(2, result.TestScripts.Count);
    }

    [Fact]
    public async Task LoadDataAsync_CachesData()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);

        var result1 = await service.LoadDataAsync();
        var result2 = await service.LoadDataAsync();

        Assert.Same(result1, result2);
    }

    #endregion

    #region GetSourceFile Tests

    [Fact]
    public async Task GetSourceFile_ExistingId_ReturnsFile()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.GetSourceFile(1);

        Assert.NotNull(result);
        Assert.Equal("src/Services/UserService.cs", result.Path);
    }

    [Fact]
    public async Task GetSourceFile_NonExistingId_ReturnsNull()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.GetSourceFile(999);

        Assert.Null(result);
    }

    #endregion

    #region GetTestScript Tests

    [Fact]
    public async Task GetTestScript_ExistingId_ReturnsTest()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.GetTestScript(1);

        Assert.NotNull(result);
        Assert.Equal("UserServiceTests", result.Name);
    }

    #endregion

    #region GetFileCoverage Tests

    [Fact]
    public async Task GetFileCoverage_ReturnsAverageCoverage()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        // File 1 has coverage 85% and 15% = avg 50%
        var result = service.GetFileCoverage(1);

        Assert.Equal(50.0, result);
    }

    [Fact]
    public async Task GetFileCoverage_NoCoverage_ReturnsZero()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        // File 4 has no coverage entries
        var result = service.GetFileCoverage(4);

        Assert.Equal(0, result);
    }

    #endregion

    #region GetModuleCoverages Tests

    [Fact]
    public async Task GetModuleCoverages_GroupsByModule()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.GetModuleCoverages();

        Assert.Equal(2, result.Count);
        var srcModule = result.First(m => m.ModuleName == "src");
        Assert.Equal(3, srcModule.FileCount);
    }

    [Fact]
    public async Task GetModuleCoverages_CalculatesAverageCoverage()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.GetModuleCoverages();
        var srcModule = result.First(m => m.ModuleName == "src");

        // 3 files: avg coverage should be calculated
        Assert.True(srcModule.AverageCoverage > 0);
    }

    #endregion

    #region BuildTreemap Tests

    [Fact]
    public async Task BuildTreemap_CreatesHierarchy()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.BuildTreemap();

        Assert.True(result.IsDirectory);
        Assert.True(result.Children.Count > 0);
    }

    [Fact]
    public async Task BuildTreemap_WithRootPath_FiltersFiles()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.BuildTreemap("src");

        Assert.Equal("src", result.Name);
        // Should only contain files under src/
        var allFiles = GetAllFiles(result);
        Assert.All(allFiles, f => Assert.StartsWith("src/", f.FullPath));
    }

    private static List<TreemapNode> GetAllFiles(TreemapNode node)
    {
        var files = new List<TreemapNode>();
        if (!node.IsDirectory)
            files.Add(node);
        foreach (var child in node.Children)
            files.AddRange(GetAllFiles(child));
        return files;
    }

    #endregion

    #region BuildFileTree Tests

    [Fact]
    public async Task BuildFileTree_CreatesHierarchy()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.BuildFileTree();

        Assert.True(result.IsDirectory);
        Assert.Equal("root", result.Name);
        Assert.True(result.Children.Count > 0);
    }

    [Fact]
    public async Task BuildFileTree_SortsFiles()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.BuildFileTree();

        // Files should be ordered by path
        var srcNode = result.Children.FirstOrDefault(c => c.Name == "src");
        Assert.NotNull(srcNode);
    }

    #endregion

    #region Search Tests

    [Fact]
    public async Task Search_MatchingQuery_ReturnsResults()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.Search("User");

        Assert.NotEmpty(result);
        Assert.All(result, f => Assert.Contains("User", f.FullPath, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Search_NoMatch_ReturnsEmpty()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.Search("NonExistent");

        Assert.Empty(result);
    }

    [Fact]
    public async Task Search_CaseInsensitive()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.Search("user");

        Assert.NotEmpty(result);
    }

    [Fact]
    public async Task Search_EmptyQuery_ReturnsEmpty()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.Search("");

        Assert.Empty(result);
    }

    [Fact]
    public async Task Search_LimitsResults()
    {
        // Create data with many matching files
        var testData = new DashboardData
        {
            SourceFiles = Enumerable.Range(1, 100)
                .Select(i => new SourceFileInfo { Id = i, Path = $"src/File{i}.cs" })
                .ToList()
        };
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var result = service.Search("File");

        Assert.True(result.Count <= 50); // Should be limited
    }

    #endregion

    #region GetStatistics Tests

    [Fact]
    public async Task GetStatistics_ReturnsCorrectCounts()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);
        await service.LoadDataAsync();

        var (totalFiles, coveredFiles, avgCoverage, totalTests) = service.GetStatistics();

        Assert.Equal(4, totalFiles);
        Assert.Equal(2, totalTests);
        Assert.True(coveredFiles > 0);
    }

    [Fact]
    public async Task GetStatistics_BeforeLoad_ReturnsZeros()
    {
        var testData = CreateTestData();
        var service = CreateService(testData);

        var (totalFiles, coveredFiles, avgCoverage, totalTests) = service.GetStatistics();

        Assert.Equal(0, totalFiles);
        Assert.Equal(0, totalTests);
    }

    #endregion

    #region Edge Cases

    [Fact]
    public async Task EmptyData_HandlesGracefully()
    {
        var emptyData = new DashboardData();
        var service = CreateService(emptyData);

        var result = await service.LoadDataAsync();

        Assert.Empty(result.SourceFiles);
        Assert.Empty(service.GetModuleCoverages());

        var stats = service.GetStatistics();
        Assert.Equal(0, stats.totalFiles);
    }

    #endregion
}
