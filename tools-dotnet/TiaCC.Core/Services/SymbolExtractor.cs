using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TiaCC.Core.Services;

/// <summary>
/// Extracts symbols (classes, methods, properties) from source files using Roslyn
/// </summary>
public class SymbolExtractor
{
    /// <summary>
    /// Extract all symbols from a C# source file
    /// </summary>
    public List<ExtractedSymbol> ExtractFromCSharp(string filePath)
    {
        if (!File.Exists(filePath))
        {
            return [];
        }

        var code = File.ReadAllText(filePath);
        return ExtractFromCSharpCode(code, filePath);
    }

    /// <summary>
    /// Extract all symbols from C# source code
    /// </summary>
    public List<ExtractedSymbol> ExtractFromCSharpCode(string code, string filePath = "")
    {
        var symbols = new List<ExtractedSymbol>();

        try
        {
            var tree = CSharpSyntaxTree.ParseText(code);
            var root = tree.GetRoot();

            // Extract namespaces
            foreach (var ns in root.DescendantNodes().OfType<NamespaceDeclarationSyntax>())
            {
                symbols.Add(CreateSymbol(ns, "namespace", filePath, ns.Name.ToString()));
            }

            // Also handle file-scoped namespaces
            foreach (var ns in root.DescendantNodes().OfType<FileScopedNamespaceDeclarationSyntax>())
            {
                symbols.Add(CreateSymbol(ns, "namespace", filePath, ns.Name.ToString()));
            }

            // Extract classes
            foreach (var classDecl in root.DescendantNodes().OfType<ClassDeclarationSyntax>())
            {
                var className = GetFullTypeName(classDecl);
                symbols.Add(CreateSymbol(classDecl, "class", filePath, className));

                // Extract methods in this class
                foreach (var method in classDecl.Members.OfType<MethodDeclarationSyntax>())
                {
                    var methodName = $"{className}.{method.Identifier.Text}";
                    symbols.Add(CreateSymbol(method, "method", filePath, methodName));
                }

                // Extract constructors
                foreach (var ctor in classDecl.Members.OfType<ConstructorDeclarationSyntax>())
                {
                    var ctorName = $"{className}.{ctor.Identifier.Text}";
                    symbols.Add(CreateSymbol(ctor, "constructor", filePath, ctorName));
                }

                // Extract properties
                foreach (var prop in classDecl.Members.OfType<PropertyDeclarationSyntax>())
                {
                    var propName = $"{className}.{prop.Identifier.Text}";
                    symbols.Add(CreateSymbol(prop, "property", filePath, propName));
                }

                // Extract fields
                foreach (var field in classDecl.Members.OfType<FieldDeclarationSyntax>())
                {
                    foreach (var variable in field.Declaration.Variables)
                    {
                        var fieldName = $"{className}.{variable.Identifier.Text}";
                        symbols.Add(CreateSymbol(field, "field", filePath, fieldName));
                    }
                }
            }

            // Extract records
            foreach (var recordDecl in root.DescendantNodes().OfType<RecordDeclarationSyntax>())
            {
                var recordName = GetFullTypeName(recordDecl);
                symbols.Add(CreateSymbol(recordDecl, "record", filePath, recordName));

                // Extract methods in this record
                foreach (var method in recordDecl.Members.OfType<MethodDeclarationSyntax>())
                {
                    var methodName = $"{recordName}.{method.Identifier.Text}";
                    symbols.Add(CreateSymbol(method, "method", filePath, methodName));
                }
            }

            // Extract structs
            foreach (var structDecl in root.DescendantNodes().OfType<StructDeclarationSyntax>())
            {
                var structName = GetFullTypeName(structDecl);
                symbols.Add(CreateSymbol(structDecl, "struct", filePath, structName));

                // Extract methods in this struct
                foreach (var method in structDecl.Members.OfType<MethodDeclarationSyntax>())
                {
                    var methodName = $"{structName}.{method.Identifier.Text}";
                    symbols.Add(CreateSymbol(method, "method", filePath, methodName));
                }
            }

            // Extract interfaces
            foreach (var interfaceDecl in root.DescendantNodes().OfType<InterfaceDeclarationSyntax>())
            {
                var interfaceName = GetFullTypeName(interfaceDecl);
                symbols.Add(CreateSymbol(interfaceDecl, "interface", filePath, interfaceName));

                // Extract method signatures
                foreach (var method in interfaceDecl.Members.OfType<MethodDeclarationSyntax>())
                {
                    var methodName = $"{interfaceName}.{method.Identifier.Text}";
                    symbols.Add(CreateSymbol(method, "method", filePath, methodName));
                }
            }

            // Extract enums
            foreach (var enumDecl in root.DescendantNodes().OfType<EnumDeclarationSyntax>())
            {
                var enumName = GetFullTypeName(enumDecl);
                symbols.Add(CreateSymbol(enumDecl, "enum", filePath, enumName));

                // Extract enum members
                foreach (var member in enumDecl.Members)
                {
                    var memberName = $"{enumName}.{member.Identifier.Text}";
                    symbols.Add(CreateSymbol(member, "enum_member", filePath, memberName));
                }
            }

            // Extract delegates
            foreach (var delegateDecl in root.DescendantNodes().OfType<DelegateDeclarationSyntax>())
            {
                symbols.Add(CreateSymbol(delegateDecl, "delegate", filePath, delegateDecl.Identifier.Text));
            }

            // Extract top-level statements (for minimal APIs, etc.)
            var globalStatements = root.DescendantNodes().OfType<GlobalStatementSyntax>().ToList();
            if (globalStatements.Count > 0)
            {
                var firstLine = tree.GetLineSpan(globalStatements.First().Span).StartLinePosition.Line + 1;
                var lastLine = tree.GetLineSpan(globalStatements.Last().Span).EndLinePosition.Line + 1;
                symbols.Add(new ExtractedSymbol
                {
                    Name = "<Program>$",
                    SymbolType = "top_level_statements",
                    FilePath = filePath,
                    StartLine = firstLine,
                    EndLine = lastLine
                });
            }
        }
        catch (Exception)
        {
            // If parsing fails, return empty list
        }

        return symbols;
    }

    /// <summary>
    /// Extract symbols from multiple files
    /// </summary>
    public async Task<List<ExtractedSymbol>> ExtractFromDirectoryAsync(
        string directory,
        string[] patterns,
        CancellationToken cancellationToken = default)
    {
        var allSymbols = new List<ExtractedSymbol>();

        foreach (var pattern in patterns)
        {
            var files = Directory.GetFiles(directory, pattern, SearchOption.AllDirectories);

            foreach (var file in files)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var relativePath = Path.GetRelativePath(directory, file).Replace('\\', '/');
                var extension = Path.GetExtension(file).ToLowerInvariant();

                List<ExtractedSymbol> symbols = extension switch
                {
                    ".cs" => ExtractFromCSharp(file),
                    // Future: add support for other languages
                    // ".cpp" or ".c" or ".h" or ".hpp" => ExtractFromCpp(file),
                    // ".py" => ExtractFromPython(file),
                    // ".ts" or ".tsx" => ExtractFromTypeScript(file),
                    _ => []
                };

                // Update file paths to relative
                foreach (var symbol in symbols)
                {
                    symbol.FilePath = relativePath;
                }

                allSymbols.AddRange(symbols);
            }
        }

        return await Task.FromResult(allSymbols);
    }

    private static ExtractedSymbol CreateSymbol(SyntaxNode node, string type, string filePath, string name)
    {
        var tree = node.SyntaxTree;
        var lineSpan = tree.GetLineSpan(node.Span);

        return new ExtractedSymbol
        {
            Name = name,
            SymbolType = type,
            FilePath = filePath,
            StartLine = lineSpan.StartLinePosition.Line + 1, // 1-based
            EndLine = lineSpan.EndLinePosition.Line + 1
        };
    }

    private static string GetFullTypeName(TypeDeclarationSyntax typeDecl)
    {
        var parts = new List<string> { typeDecl.Identifier.Text };

        // Add type parameters if generic
        if (typeDecl.TypeParameterList != null)
        {
            parts[0] += $"<{string.Join(", ", typeDecl.TypeParameterList.Parameters.Select(p => p.Identifier.Text))}>";
        }

        // Walk up to find containing types/namespaces
        var parent = typeDecl.Parent;
        while (parent != null)
        {
            switch (parent)
            {
                case TypeDeclarationSyntax parentType:
                    parts.Insert(0, parentType.Identifier.Text);
                    break;
                case NamespaceDeclarationSyntax ns:
                    parts.Insert(0, ns.Name.ToString());
                    break;
                case FileScopedNamespaceDeclarationSyntax fsns:
                    parts.Insert(0, fsns.Name.ToString());
                    break;
            }
            parent = parent.Parent;
        }

        return string.Join(".", parts);
    }

    private static string GetFullTypeName(EnumDeclarationSyntax enumDecl)
    {
        var parts = new List<string> { enumDecl.Identifier.Text };

        // Walk up to find containing types/namespaces
        var parent = enumDecl.Parent;
        while (parent != null)
        {
            switch (parent)
            {
                case TypeDeclarationSyntax parentType:
                    parts.Insert(0, parentType.Identifier.Text);
                    break;
                case EnumDeclarationSyntax parentEnum:
                    parts.Insert(0, parentEnum.Identifier.Text);
                    break;
                case NamespaceDeclarationSyntax ns:
                    parts.Insert(0, ns.Name.ToString());
                    break;
                case FileScopedNamespaceDeclarationSyntax fsns:
                    parts.Insert(0, fsns.Name.ToString());
                    break;
            }
            parent = parent.Parent;
        }

        return string.Join(".", parts);
    }
}

/// <summary>
/// Represents an extracted symbol from source code
/// </summary>
public class ExtractedSymbol
{
    public required string Name { get; set; }
    public required string SymbolType { get; set; }
    public required string FilePath { get; set; }
    public int StartLine { get; set; }
    public int EndLine { get; set; }

    public override string ToString() => $"{SymbolType} {Name} ({FilePath}:{StartLine}-{EndLine})";
}
