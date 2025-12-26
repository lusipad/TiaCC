using Xunit;
using MixedApp;

namespace MixedApp.Tests;

/// <summary>
/// MathService 单元测试
/// 测试 C# 服务层调用 C++ 原生库的数学功能
/// </summary>
public class MathServiceTests
{
    private readonly MathService _mathService = new();

    #region 基础运算测试

    [Fact]
    public void Add_PositiveNumbers_ReturnsSum()
    {
        Assert.Equal(5.0, _mathService.Add(2, 3), 0.001);
    }

    [Fact]
    public void Add_NegativeNumbers_ReturnsSum()
    {
        Assert.Equal(-5.0, _mathService.Add(-2, -3), 0.001);
    }

    [Fact]
    public void Add_MixedNumbers_ReturnsSum()
    {
        Assert.Equal(0.0, _mathService.Add(-5, 5), 0.001);
    }

    [Fact]
    public void Subtract_PositiveNumbers_ReturnsDifference()
    {
        Assert.Equal(2.0, _mathService.Subtract(5, 3), 0.001);
    }

    [Fact]
    public void Multiply_PositiveNumbers_ReturnsProduct()
    {
        Assert.Equal(12.0, _mathService.Multiply(3, 4), 0.001);
    }

    [Fact]
    public void Multiply_ByZero_ReturnsZero()
    {
        Assert.Equal(0.0, _mathService.Multiply(100, 0), 0.001);
    }

    [Fact]
    public void Divide_ValidDivision_ReturnsQuotient()
    {
        Assert.Equal(2.5, _mathService.Divide(5, 2), 0.001);
    }

    [Fact]
    public void Divide_ByZero_ThrowsDivideByZeroException()
    {
        Assert.Throws<DivideByZeroException>(() => _mathService.Divide(1, 0));
    }

    #endregion

    #region 高级运算测试

    [Theory]
    [InlineData(2, 3, 8)]
    [InlineData(2, 0, 1)]
    [InlineData(5, 2, 25)]
    [InlineData(10, 1, 10)]
    public void Power_ValidInputs_ReturnsCorrectResult(double baseValue, int exponent, double expected)
    {
        Assert.Equal(expected, _mathService.Power(baseValue, exponent), 0.001);
    }

    [Fact]
    public void Power_NegativeExponent_ReturnsCorrectResult()
    {
        Assert.Equal(0.5, _mathService.Power(2, -1), 0.001);
    }

    [Theory]
    [InlineData(4, 2)]
    [InlineData(9, 3)]
    [InlineData(16, 4)]
    [InlineData(0, 0)]
    public void Sqrt_ValidInputs_ReturnsCorrectResult(double value, double expected)
    {
        Assert.Equal(expected, _mathService.Sqrt(value), 0.001);
    }

    [Fact]
    public void Sqrt_NegativeNumber_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() => _mathService.Sqrt(-1));
    }

    [Theory]
    [InlineData(5, 5)]
    [InlineData(-5, 5)]
    [InlineData(0, 0)]
    public void Abs_ReturnsAbsoluteValue(double input, double expected)
    {
        Assert.Equal(expected, _mathService.Abs(input), 0.001);
    }

    #endregion

    #region 向量运算测试

    [Fact]
    public void DotProduct_ValidVectors_ReturnsCorrectResult()
    {
        var a = new double[] { 1, 2, 3 };
        var b = new double[] { 4, 5, 6 };

        // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
        Assert.Equal(32.0, _mathService.DotProduct(a, b), 0.001);
    }

    [Fact]
    public void DotProduct_OrthogonalVectors_ReturnsZero()
    {
        var a = new double[] { 1, 0 };
        var b = new double[] { 0, 1 };

        Assert.Equal(0.0, _mathService.DotProduct(a, b), 0.001);
    }

    [Fact]
    public void Normalize_UnitVector_RemainsUnit()
    {
        var vec = new double[] { 1, 0, 0 };
        _mathService.Normalize(vec);

        Assert.Equal(1.0, vec[0], 0.001);
        Assert.Equal(0.0, vec[1], 0.001);
        Assert.Equal(0.0, vec[2], 0.001);
    }

    [Fact]
    public void Normalize_ValidVector_HasUnitLength()
    {
        var vec = new double[] { 3, 4 }; // 长度 = 5
        _mathService.Normalize(vec);

        // 归一化后长度应为 1
        double length = Math.Sqrt(vec[0] * vec[0] + vec[1] * vec[1]);
        Assert.Equal(1.0, length, 0.001);
    }

    #endregion

    #region 矩阵运算测试

    [Fact]
    public void MatrixMultiply_IdentityMatrix_ReturnsOriginal()
    {
        var a = new double[,] { { 1, 2 }, { 3, 4 } };
        var identity = new double[,] { { 1, 0 }, { 0, 1 } };

        var result = _mathService.MatrixMultiply(a, identity);

        Assert.Equal(1, result[0, 0], 0.001);
        Assert.Equal(2, result[0, 1], 0.001);
        Assert.Equal(3, result[1, 0], 0.001);
        Assert.Equal(4, result[1, 1], 0.001);
    }

    [Fact]
    public void MatrixMultiply_2x2Matrices_ReturnsCorrectResult()
    {
        var a = new double[,] { { 1, 2 }, { 3, 4 } };
        var b = new double[,] { { 5, 6 }, { 7, 8 } };

        var result = _mathService.MatrixMultiply(a, b);

        // [1*5+2*7, 1*6+2*8] = [19, 22]
        // [3*5+4*7, 3*6+4*8] = [43, 50]
        Assert.Equal(19, result[0, 0], 0.001);
        Assert.Equal(22, result[0, 1], 0.001);
        Assert.Equal(43, result[1, 0], 0.001);
        Assert.Equal(50, result[1, 1], 0.001);
    }

    #endregion
}
