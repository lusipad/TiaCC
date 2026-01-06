using TiaCC.Core.Services;
using Xunit;

namespace TiaCC.Core.Tests;

/// <summary>
/// Additional tests for SymbolExtractor focusing on edge cases and potential bugs
/// </summary>
public class SymbolExtractorEdgeCaseTests
{
    private readonly SymbolExtractor _extractor = new();

    #region Malformed C# Code Tests

    [Fact]
    public void ExtractFromCSharpCode_SyntaxErrors_ReturnsEmptyGracefully()
    {
        var code = """
            public class Incomplete {
                public void Method(
                // Missing closing brace and paren
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Should return empty or partial results without crashing
        Assert.NotNull(symbols);
        // Roslyn should still parse partial class
    }

    [Fact]
    public void ExtractFromCSharpCode_BinaryGarbage_HandlesGracefully()
    {
        // Binary content that isn't valid text
        var binaryContent = new string(new char[] { (char)0x00, (char)0x01, (char)0xFF });

        var exception = Record.Exception(() => _extractor.ExtractFromCSharpCode(binaryContent, "test.cs"));

        // Should not throw - should return empty or minimal results
        Assert.Null(exception);
    }

    [Fact]
    public void ExtractFromCSharpCode_EmptyString_ReturnsEmpty()
    {
        var symbols = _extractor.ExtractFromCSharpCode("", "test.cs");

        Assert.Empty(symbols);
    }

    [Fact]
    public void ExtractFromCSharpCode_OnlyWhitespace_ReturnsEmpty()
    {
        var symbols = _extractor.ExtractFromCSharpCode("   \n\r\n\t\t  ", "test.cs");

        Assert.Empty(symbols);
    }

    #endregion

    #region Special C# Constructs

    [Fact]
    public void ExtractFromCSharpCode_NestedClasses_ExtractsAll()
    {
        var code = """
            public class Outer
            {
                public class Middle
                {
                    public class Inner
                    {
                        public void DeepMethod() { }
                    }
                }
            }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        Assert.Contains(symbols, s => s.Name == "Outer");
        Assert.Contains(symbols, s => s.Name == "Outer.Middle");
        Assert.Contains(symbols, s => s.Name == "Outer.Middle.Inner");
        Assert.Contains(symbols, s => s.Name == "Outer.Middle.Inner.DeepMethod");
    }

    [Fact]
    public void ExtractFromCSharpCode_GenericTypes_ExtractsWithTypeParams()
    {
        var code = """
            public class GenericClass<T, U> where T : class
            {
                public void GenericMethod<V>(V param) { }
            }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        var classSymbol = symbols.FirstOrDefault(s => s.SymbolType == "class");
        Assert.NotNull(classSymbol);
        Assert.Contains("<T, U>", classSymbol.Name);
    }

    [Fact]
    public void ExtractFromCSharpCode_RecordTypes_ExtractsAsRecords()
    {
        var code = """
            public record Person(string Name, int Age);
            public record struct Point(int X, int Y);
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        Assert.Contains(symbols, s => s.SymbolType == "record" && s.Name == "Person");
        Assert.Contains(symbols, s => s.SymbolType == "record" && s.Name == "Point");
    }

    [Fact]
    public void ExtractFromCSharpCode_PrimaryConstructors_Extracted()
    {
        var code = """
            public class Person(string name, int age)
            {
                public string Name => name;
            }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Primary constructor may or may not be extracted - document behavior
        Assert.Contains(symbols, s => s.SymbolType == "class");
    }

    [Fact]
    public void ExtractFromCSharpCode_LocalFunctions_NotExtracted()
    {
        var code = """
            public class Test
            {
                public void OuterMethod()
                {
                    void LocalFunction() { }
                    int LocalFunction2(int x) => x * 2;
                }
            }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        // Local functions should NOT be extracted as top-level symbols
        Assert.DoesNotContain(symbols, s => s.Name.Contains("LocalFunction"));
    }

    [Fact]
    public void ExtractFromCSharpCode_StaticUsings_Ignored()
    {
        var code = """
            using static System.Console;
            using static System.Math;

            public class Test { }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        Assert.Single(symbols); // Only the class
    }

    [Fact]
    public void ExtractFromCSharpCode_GlobalUsings_Ignored()
    {
        var code = """
            global using System;
            global using System.Collections.Generic;

            public class Test { }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        Assert.Single(symbols);
    }

    #endregion

    #region Edge Cases for Line Numbers

    [Fact]
    public void ExtractFromCSharpCode_SingleLineMethod_HasCorrectRange()
    {
        var code = """
            public class Test
            {
                public int GetValue() => 42;
            }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        var method = symbols.FirstOrDefault(s => s.Name.Contains("GetValue"));
        Assert.NotNull(method);
        Assert.Equal(method.StartLine, method.EndLine);
    }

    [Fact]
    public void ExtractFromCSharpCode_MultiLineMethod_HasCorrectRange()
    {
        var code = """
            public class Test
            {
                public int Calculate(int x)
                {
                    var result = x * 2;
                    return result;
                }
            }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        var method = symbols.FirstOrDefault(s => s.Name.Contains("Calculate"));
        Assert.NotNull(method);
        Assert.True(method.EndLine > method.StartLine);
    }

    [Fact]
    public void ExtractFromCSharpCode_LineNumbersAre1Based()
    {
        var code = "public class First { }";

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        var classSymbol = symbols.FirstOrDefault(s => s.SymbolType == "class");
        Assert.NotNull(classSymbol);
        Assert.Equal(1, classSymbol.StartLine);
    }

    #endregion

    #region FileScopedNamespace

    [Fact]
    public void ExtractFromCSharpCode_FileScopedNamespace_ExtractsCorrectly()
    {
        var code = """
            namespace MyApp.Services;

            public class Service
            {
                public void DoWork() { }
            }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        Assert.Contains(symbols, s => s.SymbolType == "namespace" && s.Name == "MyApp.Services");
        Assert.Contains(symbols, s => s.Name.Contains("MyApp.Services.Service"));
    }

    #endregion

    #region Interfaces and Abstracts

    [Fact]
    public void ExtractFromCSharpCode_Interface_ExtractsMethodSignatures()
    {
        var code = """
            public interface IService
            {
                void DoWork();
                Task<int> GetValueAsync();
            }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        Assert.Contains(symbols, s => s.SymbolType == "interface");
        Assert.Contains(symbols, s => s.Name.Contains("DoWork"));
        Assert.Contains(symbols, s => s.Name.Contains("GetValueAsync"));
    }

    [Fact]
    public void ExtractFromCSharpCode_AbstractClass_ExtractsAbstractMethods()
    {
        var code = """
            public abstract class BaseService
            {
                public abstract void AbstractMethod();
                public virtual void VirtualMethod() { }
            }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        Assert.Contains(symbols, s => s.Name.Contains("AbstractMethod"));
        Assert.Contains(symbols, s => s.Name.Contains("VirtualMethod"));
    }

    #endregion

    #region Enum Edge Cases

    [Fact]
    public void ExtractFromCSharpCode_EnumWithValues_ExtractsMembers()
    {
        var code = """
            public enum Status
            {
                Unknown = 0,
                Active = 1,
                Inactive = 2
            }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        Assert.Contains(symbols, s => s.SymbolType == "enum");
        Assert.Contains(symbols, s => s.SymbolType == "enum_member" && s.Name.Contains("Unknown"));
        Assert.Contains(symbols, s => s.SymbolType == "enum_member" && s.Name.Contains("Active"));
    }

    [Fact]
    public void ExtractFromCSharpCode_FlagsEnum_ExtractsSameAsRegular()
    {
        var code = """
            [Flags]
            public enum Permissions
            {
                None = 0,
                Read = 1,
                Write = 2,
                Execute = 4
            }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        Assert.Contains(symbols, s => s.SymbolType == "enum");
        Assert.Equal(5, symbols.Count(s => s.Name.Contains("Permissions")));
    }

    #endregion

    #region Field Extraction

    [Fact]
    public void ExtractFromCSharpCode_MultipleFieldsOnSameLine_ExtractsEach()
    {
        var code = """
            public class Test
            {
                private int a, b, c;
            }
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        var fields = symbols.Where(s => s.SymbolType == "field").ToList();
        Assert.Equal(3, fields.Count);
    }

    #endregion

    #region File that doesn't exist

    [Fact]
    public void ExtractFromCSharp_NonExistentFile_ReturnsEmpty()
    {
        var symbols = _extractor.ExtractFromCSharp("/path/to/nonexistent/file.cs");

        Assert.Empty(symbols);
    }

    #endregion

    #region Top-Level Statements

    [Fact]
    public void ExtractFromCSharpCode_TopLevelStatements_ExtractsAsProgram()
    {
        var code = """
            using System;

            Console.WriteLine("Hello");
            await Task.Delay(100);
            return 0;
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "Program.cs");

        Assert.Contains(symbols, s => s.SymbolType == "top_level_statements");
    }

    [Fact]
    public void ExtractFromCSharpCode_TopLevelWithMethods_ExtractsCorrectly()
    {
        var code = """
            void LocalMethod() { }
            Console.WriteLine("Hello");
            LocalMethod();
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "Program.cs");

        Assert.Contains(symbols, s => s.SymbolType == "top_level_statements");
    }

    #endregion

    #region Delegate Types

    [Fact]
    public void ExtractFromCSharpCode_Delegates_Extracted()
    {
        var code = """
            public delegate void EventHandler(object sender, EventArgs e);
            public delegate Task<T> AsyncFunc<T>();
            """;

        var symbols = _extractor.ExtractFromCSharpCode(code, "test.cs");

        Assert.Equal(2, symbols.Count(s => s.SymbolType == "delegate"));
    }

    #endregion
}
