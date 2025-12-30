using TiaCC.Core.Services;
using Xunit;

namespace TiaCC.Core.Tests;

public class CoverageParserTests : IDisposable
{
    private readonly string _testDir;

    public CoverageParserTests()
    {
        _testDir = Path.Combine(Path.GetTempPath(), $"tiacc_test_{Guid.NewGuid():N}");
        Directory.CreateDirectory(_testDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_testDir))
            Directory.Delete(_testDir, true);
        GC.SuppressFinalize(this);
    }

    #region Cobertura XML Tests

    [Fact]
    public void ParseCoberturaXml_ValidFile_ReturnsCoverageData()
    {
        // Arrange
        var xml = """
            <?xml version="1.0" encoding="utf-8"?>
            <coverage version="1.0">
                <packages>
                    <package name="test">
                        <classes>
                            <class name="Calculator" filename="src/calculator.cpp" line-rate="0.8">
                                <lines>
                                    <line number="1" hits="1"/>
                                    <line number="2" hits="1"/>
                                    <line number="3" hits="0"/>
                                    <line number="4" hits="1"/>
                                    <line number="5" hits="1"/>
                                </lines>
                                <methods>
                                    <method name="add">
                                        <lines>
                                            <line number="1" hits="1"/>
                                            <line number="2" hits="1"/>
                                        </lines>
                                    </method>
                                </methods>
                            </class>
                        </classes>
                    </package>
                </packages>
            </coverage>
            """;
        var filePath = Path.Combine(_testDir, "coverage.xml");
        File.WriteAllText(filePath, xml);

        // Act
        var result = CoverageParser.ParseCoberturaXml(filePath);

        // Assert
        Assert.NotEmpty(result.Files);
        Assert.Contains("src/calculator.cpp", result.Files.Keys);
        Assert.Equal(80, result.Files["src/calculator.cpp"].CoveragePercent);
        Assert.NotEmpty(result.Functions);
    }

    [Fact]
    public void ParseCoberturaXml_WithBasePath_NormalizesFilePaths()
    {
        var xml = """
            <?xml version="1.0" encoding="utf-8"?>
            <coverage version="1.0">
                <packages>
                    <package name="test">
                        <classes>
                            <class name="Calculator" filename="/home/user/project/src/calculator.cpp" line-rate="0.75">
                                <lines>
                                    <line number="1" hits="1"/>
                                    <line number="2" hits="1"/>
                                    <line number="3" hits="1"/>
                                    <line number="4" hits="0"/>
                                </lines>
                            </class>
                        </classes>
                    </package>
                </packages>
            </coverage>
            """;
        var filePath = Path.Combine(_testDir, "coverage.xml");
        File.WriteAllText(filePath, xml);

        var result = CoverageParser.ParseCoberturaXml(filePath, "/home/user/project");

        Assert.Contains("src/calculator.cpp", result.Files.Keys);
    }

    #endregion

    #region LCOV Tests

    [Fact]
    public void ParseLcov_ValidFile_ReturnsCoverageData()
    {
        var lcov = """
            SF:src/calculator.cpp
            FN:1,add
            FN:10,subtract
            FNDA:5,add
            FNDA:0,subtract
            DA:1,1
            DA:2,1
            DA:3,0
            DA:10,0
            DA:11,0
            end_of_record
            SF:src/utils.cpp
            DA:1,1
            DA:2,1
            end_of_record
            """;
        var filePath = Path.Combine(_testDir, "coverage.info");
        File.WriteAllText(filePath, lcov);

        var result = CoverageParser.ParseLcov(filePath);

        Assert.Equal(2, result.Files.Count);
        Assert.Contains("src/calculator.cpp", result.Files.Keys);
        Assert.Contains("src/utils.cpp", result.Files.Keys);
        Assert.Equal(40, result.Files["src/calculator.cpp"].CoveragePercent); // 2/5 = 40%
        Assert.Equal(100, result.Files["src/utils.cpp"].CoveragePercent);
        Assert.Single(result.Functions); // Only 'add' has hits > 0
    }

    [Fact]
    public void ParseLcov_EmptyFile_ReturnsEmptyData()
    {
        var filePath = Path.Combine(_testDir, "empty.info");
        File.WriteAllText(filePath, "");

        var result = CoverageParser.ParseLcov(filePath);

        Assert.Empty(result.Files);
        Assert.Empty(result.Functions);
    }

    #endregion

    #region Coverlet JSON Tests

    [Fact]
    public void ParseCoverletJson_ValidFile_ReturnsCoverageData()
    {
        var json = """
            {
                "MyAssembly.dll": {
                    "src/Calculator.cs": {
                        "Calculator.Add(int, int)": {
                            "Lines": {
                                "10": 5,
                                "11": 5,
                                "12": 5
                            }
                        },
                        "Calculator.Subtract(int, int)": {
                            "Lines": {
                                "20": 0,
                                "21": 0
                            }
                        }
                    }
                }
            }
            """;
        var filePath = Path.Combine(_testDir, "coverage.coverage.json");
        File.WriteAllText(filePath, json);

        var result = CoverageParser.ParseCoverletJson(filePath);

        Assert.Single(result.Files);
        Assert.Contains("src/Calculator.cs", result.Files.Keys);
        var file = result.Files["src/Calculator.cs"];
        Assert.Equal(3, file.CoveredLines);
        Assert.Equal(5, file.TotalLines);
        Assert.Single(result.Functions); // Only Add has hits
    }

    #endregion

    #region Istanbul JSON Tests

    [Fact]
    public void ParseIstanbulJson_ValidFile_ReturnsCoverageData()
    {
        var json = """
            {
                "/home/user/src/index.js": {
                    "s": {"0": 1, "1": 1, "2": 0},
                    "f": {"0": 5, "1": 0},
                    "fnMap": {
                        "0": {"name": "main", "decl": {"start": {"line": 1}, "end": {"line": 10}}},
                        "1": {"name": "unused", "decl": {"start": {"line": 15}, "end": {"line": 20}}}
                    }
                }
            }
            """;
        var filePath = Path.Combine(_testDir, "coverage-final.json");
        File.WriteAllText(filePath, json);

        var result = CoverageParser.ParseIstanbulJson(filePath, "/home/user");

        Assert.Single(result.Files);
        Assert.Contains("src/index.js", result.Files.Keys);
        var file = result.Files["src/index.js"];
        Assert.Equal(2, file.CoveredLines);
        Assert.Equal(3, file.TotalLines);
        Assert.Single(result.Functions); // Only 'main' has hits
    }

    #endregion

    #region JaCoCo XML Tests

    [Fact]
    public void ParseJacocoXml_ValidFile_ReturnsCoverageData()
    {
        var xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <report name="Test">
                <package name="com/example">
                    <class name="com/example/Calculator" sourcefilename="Calculator.java">
                        <method name="add" line="10">
                            <counter type="LINE" missed="0" covered="5"/>
                        </method>
                        <counter type="LINE" missed="2" covered="8"/>
                    </class>
                </package>
            </report>
            """;
        var filePath = Path.Combine(_testDir, "jacoco.xml");
        File.WriteAllText(filePath, xml);

        var result = CoverageParser.ParseJacocoXml(filePath);

        Assert.Single(result.Files);
        Assert.Contains("com/example/Calculator.java", result.Files.Keys);
        Assert.Equal(80, result.Files["com/example/Calculator.java"].CoveragePercent);
    }

    #endregion

    #region coverage.py JSON Tests

    [Fact]
    public void ParseCoveragePyJson_ValidFile_ReturnsCoverageData()
    {
        var json = """
            {
                "meta": {"version": "7.0"},
                "files": {
                    "src/calculator.py": {
                        "executed_lines": [1, 2, 3, 5, 6],
                        "missing_lines": [4, 7]
                    }
                }
            }
            """;
        var filePath = Path.Combine(_testDir, "coverage.json");
        File.WriteAllText(filePath, json);

        var result = CoverageParser.ParseCoveragePyJson(filePath);

        Assert.Single(result.Files);
        Assert.Contains("src/calculator.py", result.Files.Keys);
        var file = result.Files["src/calculator.py"];
        Assert.Equal(5, file.CoveredLines);
        Assert.Equal(7, file.TotalLines);
    }

    #endregion

    #region Auto-detection Tests

    [Fact]
    public void Parse_CoberturaXml_AutoDetects()
    {
        var xml = """
            <?xml version="1.0"?>
            <coverage version="1.0">
                <packages>
                    <package name="test">
                        <classes>
                            <class name="Test" filename="test.cpp" line-rate="1.0">
                                <lines><line number="1" hits="1"/></lines>
                            </class>
                        </classes>
                    </package>
                </packages>
            </coverage>
            """;
        var filePath = Path.Combine(_testDir, "coverage.xml");
        File.WriteAllText(filePath, xml);

        var result = CoverageParser.Parse(filePath);

        Assert.NotEmpty(result.Files);
    }

    [Fact]
    public void Parse_Lcov_AutoDetects()
    {
        var lcov = """
            SF:src/test.cpp
            DA:1,1
            end_of_record
            """;
        var filePath = Path.Combine(_testDir, "coverage.info");
        File.WriteAllText(filePath, lcov);

        var result = CoverageParser.Parse(filePath);

        Assert.NotEmpty(result.Files);
    }

    [Fact]
    public void Parse_UnsupportedFormat_ThrowsException()
    {
        var filePath = Path.Combine(_testDir, "coverage.unsupported");
        File.WriteAllText(filePath, "invalid");

        Assert.Throws<NotSupportedException>(() => CoverageParser.Parse(filePath));
    }

    #endregion

    #region Edge Cases

    [Fact]
    public void ParseCoberturaXml_NoPackages_ReturnsEmptyData()
    {
        var xml = """
            <?xml version="1.0"?>
            <coverage version="1.0">
                <packages></packages>
            </coverage>
            """;
        var filePath = Path.Combine(_testDir, "empty.xml");
        File.WriteAllText(filePath, xml);

        var result = CoverageParser.ParseCoberturaXml(filePath);

        Assert.Empty(result.Files);
    }

    [Fact]
    public void ParseLcov_NoEndOfRecord_ReturnsEmptyData()
    {
        var lcov = """
            SF:src/test.cpp
            DA:1,1
            """;
        var filePath = Path.Combine(_testDir, "incomplete.info");
        File.WriteAllText(filePath, lcov);

        var result = CoverageParser.ParseLcov(filePath);

        // File should not be included without end_of_record
        Assert.Empty(result.Files);
    }

    #endregion
}
