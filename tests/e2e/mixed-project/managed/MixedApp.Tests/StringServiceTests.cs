using Xunit;
using MixedApp;

namespace MixedApp.Tests;

/// <summary>
/// StringService 单元测试
/// 测试 C# 服务层调用 C++ 原生库的字符串处理功能
/// </summary>
public class StringServiceTests
{
    private readonly StringService _stringService = new();

    #region 基础操作测试

    [Theory]
    [InlineData("Hello", 5)]
    [InlineData("", 0)]
    [InlineData("Hello World", 11)]
    public void GetLength_ReturnsCorrectLength(string input, int expected)
    {
        Assert.Equal(expected, _stringService.GetLength(input));
    }

    [Theory]
    [InlineData("hello", "HELLO")]
    [InlineData("Hello World", "HELLO WORLD")]
    [InlineData("123abc", "123ABC")]
    public void ToUpperCase_ReturnsUpperCase(string input, string expected)
    {
        Assert.Equal(expected, _stringService.ToUpperCase(input));
    }

    [Theory]
    [InlineData("HELLO", "hello")]
    [InlineData("Hello World", "hello world")]
    [InlineData("123ABC", "123abc")]
    public void ToLowerCase_ReturnsLowerCase(string input, string expected)
    {
        Assert.Equal(expected, _stringService.ToLowerCase(input));
    }

    #endregion

    #region 搜索操作测试

    [Fact]
    public void Contains_SubstringExists_ReturnsTrue()
    {
        Assert.True(_stringService.Contains("Hello World", "World"));
    }

    [Fact]
    public void Contains_SubstringNotExists_ReturnsFalse()
    {
        Assert.False(_stringService.Contains("Hello World", "XYZ"));
    }

    [Theory]
    [InlineData("Hello World", "World", 6)]
    [InlineData("Hello World", "Hello", 0)]
    [InlineData("Hello World", "XYZ", -1)]
    public void IndexOf_ReturnsCorrectPosition(string haystack, string needle, int expected)
    {
        Assert.Equal(expected, _stringService.IndexOf(haystack, needle));
    }

    [Fact]
    public void StartsWith_ValidPrefix_ReturnsTrue()
    {
        Assert.True(_stringService.StartsWith("Hello World", "Hello"));
    }

    [Fact]
    public void StartsWith_InvalidPrefix_ReturnsFalse()
    {
        Assert.False(_stringService.StartsWith("Hello World", "World"));
    }

    [Fact]
    public void EndsWith_ValidSuffix_ReturnsTrue()
    {
        Assert.True(_stringService.EndsWith("Hello World", "World"));
    }

    [Fact]
    public void EndsWith_InvalidSuffix_ReturnsFalse()
    {
        Assert.False(_stringService.EndsWith("Hello World", "Hello"));
    }

    #endregion

    #region 字符串操作测试

    [Theory]
    [InlineData("Hello", "World", "HelloWorld")]
    [InlineData("", "World", "World")]
    [InlineData("Hello", "", "Hello")]
    public void Concat_ReturnsConcatenatedString(string a, string b, string expected)
    {
        Assert.Equal(expected, _stringService.Concat(a, b));
    }

    [Theory]
    [InlineData("  Hello  ", "Hello")]
    [InlineData("Hello", "Hello")]
    [InlineData("   ", "")]
    [InlineData("  spaces here  ", "spaces here")]
    public void Trim_RemovesWhitespace(string input, string expected)
    {
        Assert.Equal(expected, _stringService.Trim(input));
    }

    [Theory]
    [InlineData("Hello", "olleH")]
    [InlineData("", "")]
    [InlineData("a", "a")]
    [InlineData("ab", "ba")]
    public void Reverse_ReturnsReversedString(string input, string expected)
    {
        Assert.Equal(expected, _stringService.Reverse(input));
    }

    #endregion

    #region 解析测试

    [Theory]
    [InlineData("123", 123)]
    [InlineData("-456", -456)]
    [InlineData("0", 0)]
    public void ParseInt_ValidInput_ReturnsInteger(string input, int expected)
    {
        Assert.Equal(expected, _stringService.ParseInt(input));
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("12.34")]
    [InlineData("")]
    public void ParseInt_InvalidInput_ThrowsFormatException(string input)
    {
        Assert.Throws<FormatException>(() => _stringService.ParseInt(input));
    }

    [Theory]
    [InlineData("3.14", 3.14)]
    [InlineData("-2.5", -2.5)]
    [InlineData("0.0", 0.0)]
    public void ParseDouble_ValidInput_ReturnsDouble(string input, double expected)
    {
        Assert.Equal(expected, _stringService.ParseDouble(input), 0.001);
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("")]
    public void ParseDouble_InvalidInput_ThrowsFormatException(string input)
    {
        Assert.Throws<FormatException>(() => _stringService.ParseDouble(input));
    }

    #endregion
}
