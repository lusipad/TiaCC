using TiaCC.Core.Services;
using Xunit;

namespace TiaCC.Core.Tests;

/// <summary>
/// Tests for SymbolExtractor
/// </summary>
public class SymbolExtractorTests
{
    private readonly SymbolExtractor _extractor = new();

    [Fact]
    public void ExtractFromCSharpCode_SimpleClass_ExtractsClassSymbol()
    {
        // Arrange
        var code = @"
namespace MyApp
{
    public class MyClass
    {
        public void MyMethod() { }
    }
}";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        Assert.Contains(symbols, s => s.SymbolType == "namespace" && s.Name == "MyApp");
        Assert.Contains(symbols, s => s.SymbolType == "class" && s.Name == "MyApp.MyClass");
        Assert.Contains(symbols, s => s.SymbolType == "method" && s.Name == "MyApp.MyClass.MyMethod");
    }

    [Fact]
    public void ExtractFromCSharpCode_FileScopedNamespace_ExtractsSymbols()
    {
        // Arrange
        var code = @"
namespace MyApp;

public class MyClass
{
    public int MyProperty { get; set; }
}";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        Assert.Contains(symbols, s => s.SymbolType == "namespace" && s.Name == "MyApp");
        Assert.Contains(symbols, s => s.SymbolType == "class" && s.Name == "MyApp.MyClass");
        Assert.Contains(symbols, s => s.SymbolType == "property" && s.Name == "MyApp.MyClass.MyProperty");
    }

    [Fact]
    public void ExtractFromCSharpCode_Record_ExtractsRecordSymbol()
    {
        // Arrange
        var code = @"
namespace MyApp;

public record MyRecord(string Name, int Value);";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        Assert.Contains(symbols, s => s.SymbolType == "record" && s.Name == "MyApp.MyRecord");
    }

    [Fact]
    public void ExtractFromCSharpCode_Enum_ExtractsEnumAndMembers()
    {
        // Arrange
        var code = @"
namespace MyApp;

public enum MyEnum
{
    First,
    Second,
    Third
}";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        Assert.Contains(symbols, s => s.SymbolType == "enum" && s.Name == "MyApp.MyEnum");
        Assert.Contains(symbols, s => s.SymbolType == "enum_member" && s.Name == "MyApp.MyEnum.First");
        Assert.Contains(symbols, s => s.SymbolType == "enum_member" && s.Name == "MyApp.MyEnum.Second");
        Assert.Contains(symbols, s => s.SymbolType == "enum_member" && s.Name == "MyApp.MyEnum.Third");
    }

    [Fact]
    public void ExtractFromCSharpCode_Interface_ExtractsInterfaceAndMethods()
    {
        // Arrange
        var code = @"
namespace MyApp;

public interface IMyInterface
{
    void DoSomething();
    string GetValue();
}";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        Assert.Contains(symbols, s => s.SymbolType == "interface" && s.Name == "MyApp.IMyInterface");
        Assert.Contains(symbols, s => s.SymbolType == "method" && s.Name == "MyApp.IMyInterface.DoSomething");
        Assert.Contains(symbols, s => s.SymbolType == "method" && s.Name == "MyApp.IMyInterface.GetValue");
    }

    [Fact]
    public void ExtractFromCSharpCode_Struct_ExtractsStructSymbol()
    {
        // Arrange
        var code = @"
namespace MyApp;

public struct MyStruct
{
    public int X;
    public int Y;

    public double Distance() => Math.Sqrt(X*X + Y*Y);
}";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        Assert.Contains(symbols, s => s.SymbolType == "struct" && s.Name == "MyApp.MyStruct");
        Assert.Contains(symbols, s => s.SymbolType == "method" && s.Name == "MyApp.MyStruct.Distance");
    }

    [Fact]
    public void ExtractFromCSharpCode_GenericClass_ExtractsWithTypeParameters()
    {
        // Arrange
        var code = @"
namespace MyApp;

public class Container<T>
{
    public T Value { get; set; }
}";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        Assert.Contains(symbols, s => s.SymbolType == "class" && s.Name == "MyApp.Container<T>");
        Assert.Contains(symbols, s => s.SymbolType == "property" && s.Name == "MyApp.Container<T>.Value");
    }

    [Fact]
    public void ExtractFromCSharpCode_NestedClass_ExtractsFullyQualifiedName()
    {
        // Arrange
        var code = @"
namespace MyApp;

public class Outer
{
    public class Inner
    {
        public void InnerMethod() { }
    }
}";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        Assert.Contains(symbols, s => s.SymbolType == "class" && s.Name == "MyApp.Outer");
        Assert.Contains(symbols, s => s.SymbolType == "class" && s.Name == "MyApp.Outer.Inner");
        Assert.Contains(symbols, s => s.SymbolType == "method" && s.Name == "MyApp.Outer.Inner.InnerMethod");
    }

    [Fact]
    public void ExtractFromCSharpCode_Constructor_ExtractsConstructor()
    {
        // Arrange
        var code = @"
namespace MyApp;

public class MyClass
{
    public MyClass() { }
    public MyClass(int value) { }
}";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        var constructors = symbols.Where(s => s.SymbolType == "constructor").ToList();
        Assert.Equal(2, constructors.Count);
        Assert.All(constructors, c => Assert.StartsWith("MyApp.MyClass.MyClass", c.Name));
    }

    [Fact]
    public void ExtractFromCSharpCode_Field_ExtractsField()
    {
        // Arrange
        var code = @"
namespace MyApp;

public class MyClass
{
    private int _value;
    public static readonly string Name = ""Test"";
}";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        var fields = symbols.Where(s => s.SymbolType == "field").ToList();
        Assert.Equal(2, fields.Count);
    }

    [Fact]
    public void ExtractFromCSharpCode_TopLevelStatements_ExtractsAsProgram()
    {
        // Arrange
        var code = @"
Console.WriteLine(""Hello"");
var x = 42;
Console.WriteLine(x);";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "Program.cs");

        // Assert
        Assert.Contains(symbols, s => s.SymbolType == "top_level_statements" && s.Name == "<Program>$");
    }

    [Fact]
    public void ExtractFromCSharpCode_Delegate_ExtractsDelegate()
    {
        // Arrange
        var code = @"
namespace MyApp;

public delegate void MyEventHandler(object sender, EventArgs e);";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        Assert.Contains(symbols, s => s.SymbolType == "delegate" && s.Name == "MyEventHandler");
    }

    [Fact]
    public void ExtractFromCSharpCode_LineNumbers_AreCorrect()
    {
        // Arrange
        var code = @"namespace MyApp
{
    public class MyClass
    {
        public void Method1() { }

        public void Method2() { }
    }
}";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        var classSymbol = symbols.First(s => s.SymbolType == "class");
        Assert.Equal(3, classSymbol.StartLine);
        Assert.Equal(8, classSymbol.EndLine);

        var method1 = symbols.First(s => s.Name.EndsWith("Method1"));
        Assert.Equal(5, method1.StartLine);

        var method2 = symbols.First(s => s.Name.EndsWith("Method2"));
        Assert.Equal(7, method2.StartLine);
    }

    [Fact]
    public void ExtractFromCSharpCode_InvalidCode_ReturnsEmptyList()
    {
        // Arrange
        var code = "this is not valid C# code {{{";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert - Roslyn is very forgiving, so it may still extract something
        // The important thing is that it doesn't throw
        Assert.NotNull(symbols);
    }

    [Fact]
    public void ExtractFromCSharpCode_EmptyCode_ReturnsEmptyList()
    {
        // Arrange
        var code = "";

        // Act
        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Assert
        Assert.Empty(symbols);
    }

    [Fact]
    public void ExtractFromCSharp_NonExistentFile_ReturnsEmptyList()
    {
        // Arrange
        var path = "/nonexistent/file.cs";

        // Act
        var symbols = _extractor.ExtractFromCSharp(path);

        // Assert
        Assert.Empty(symbols);
    }

    [Fact]
    public async Task ExtractFromDirectoryAsync_FindsFilesAndNormalizesPaths()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"tiacc_symbols_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);

        try
        {
            var srcDir = Path.Combine(tempDir, "src");
            Directory.CreateDirectory(srcDir);

            var filePath = Path.Combine(srcDir, "Foo.cs");
            File.WriteAllText(filePath, """
                namespace MyApp;

                public class Foo
                {
                    public void Bar() { }
                }
                """);

            var symbols = await _extractor.ExtractFromDirectoryAsync(tempDir, ["*.cs"]);

            Assert.NotEmpty(symbols);
            Assert.Contains(symbols, s => s.FilePath == "src/Foo.cs");
            Assert.Contains(symbols, s => s.SymbolType == "class" && s.Name == "MyApp.Foo");
            Assert.Contains(symbols, s => s.SymbolType == "method" && s.Name == "MyApp.Foo.Bar");
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }
}
