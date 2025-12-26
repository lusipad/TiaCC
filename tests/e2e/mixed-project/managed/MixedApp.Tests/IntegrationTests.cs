using Xunit;
using MixedApp;

namespace MixedApp.Tests;

/// <summary>
/// 集成测试
/// 测试 MathService 和 StringService 的组合使用场景
/// </summary>
public class IntegrationTests
{
    private readonly MathService _mathService = new();
    private readonly StringService _stringService = new();

    /// <summary>
    /// 测试计算结果转换为字符串
    /// </summary>
    [Fact]
    public void MathResultToString_Calculation()
    {
        // 计算
        double result = _mathService.Add(10, 20);

        // 转换为字符串并处理
        string resultStr = result.ToString();
        string upperResult = _stringService.ToUpperCase($"Result: {resultStr}");

        Assert.Equal("RESULT: 30", upperResult);
    }

    /// <summary>
    /// 测试解析字符串并进行计算
    /// </summary>
    [Fact]
    public void ParseAndCalculate_Integration()
    {
        // 从字符串解析数字
        int a = _stringService.ParseInt("100");
        int b = _stringService.ParseInt("50");

        // 进行计算
        double sum = _mathService.Add(a, b);
        double product = _mathService.Multiply(a, b);

        Assert.Equal(150, sum, 0.001);
        Assert.Equal(5000, product, 0.001);
    }

    /// <summary>
    /// 测试向量运算结果格式化
    /// </summary>
    [Fact]
    public void VectorOperationFormatting_Integration()
    {
        var vec1 = new double[] { 1, 2, 3 };
        var vec2 = new double[] { 4, 5, 6 };

        double dotProduct = _mathService.DotProduct(vec1, vec2);

        // 格式化结果
        string formatted = $"Dot product = {dotProduct}";
        bool containsDot = _stringService.Contains(formatted, "Dot");

        Assert.Equal(32, dotProduct, 0.001);
        Assert.True(containsDot);
    }

    /// <summary>
    /// 测试矩阵运算与字符串处理的集成
    /// </summary>
    [Fact]
    public void MatrixOperationWithStringProcessing_Integration()
    {
        var matrix = new double[,] { { 1, 2 }, { 3, 4 } };
        var identity = new double[,] { { 1, 0 }, { 0, 1 } };

        var result = _mathService.MatrixMultiply(matrix, identity);

        // 构建结果字符串
        string matrixStr = $"[{result[0, 0]},{result[0, 1]}],[{result[1, 0]},{result[1, 1]}]";
        string trimmed = _stringService.Trim($"  {matrixStr}  ");

        Assert.Equal("[1,2],[3,4]", trimmed);
    }

    /// <summary>
    /// 测试复杂计算流程
    /// </summary>
    [Fact]
    public void ComplexCalculationFlow_Integration()
    {
        // 1. 解析输入
        double x = _stringService.ParseDouble("2.5");
        double y = _stringService.ParseDouble("4.0");

        // 2. 执行计算
        double sum = _mathService.Add(x, y);           // 6.5
        double squared = _mathService.Power(sum, 2);   // 42.25
        double sqrted = _mathService.Sqrt(squared);    // 6.5

        // 3. 验证结果
        Assert.Equal(6.5, sqrted, 0.001);

        // 4. 格式化输出
        string output = _stringService.ToUpperCase($"final value: {sqrted}");
        Assert.StartsWith("FINAL VALUE:", output);
    }

    /// <summary>
    /// 测试字符串操作链
    /// </summary>
    [Fact]
    public void StringOperationChain_Integration()
    {
        string input = "  Hello, World!  ";

        // 链式操作
        string trimmed = _stringService.Trim(input);
        string upper = _stringService.ToUpperCase(trimmed);
        string reversed = _stringService.Reverse(upper);

        Assert.Equal("!DLROW ,OLLEH", reversed);

        // 验证长度
        int originalLen = _stringService.GetLength(trimmed);
        int reversedLen = _stringService.GetLength(reversed);
        Assert.Equal(originalLen, reversedLen);
    }

    /// <summary>
    /// 测试错误处理流程
    /// </summary>
    [Fact]
    public void ErrorHandlingFlow_Integration()
    {
        // 测试除零错误
        Assert.Throws<DivideByZeroException>(() =>
        {
            double a = _stringService.ParseDouble("10");
            double b = _stringService.ParseDouble("0");
            _mathService.Divide(a, b);
        });

        // 测试负数平方根错误
        Assert.Throws<ArgumentException>(() =>
        {
            double x = _stringService.ParseDouble("-4");
            _mathService.Sqrt(x);
        });

        // 测试解析错误
        Assert.Throws<FormatException>(() =>
        {
            _stringService.ParseInt("not a number");
        });
    }
}
