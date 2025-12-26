namespace MixedApp;

/// <summary>
/// 数学服务 - 封装原生数学引擎的高级接口
/// </summary>
public class MathService
{
    /// <summary>
    /// 加法
    /// </summary>
    public double Add(double a, double b)
    {
        return NativeInterop.MathEngine_Add(a, b);
    }

    /// <summary>
    /// 减法
    /// </summary>
    public double Subtract(double a, double b)
    {
        return NativeInterop.MathEngine_Subtract(a, b);
    }

    /// <summary>
    /// 乘法
    /// </summary>
    public double Multiply(double a, double b)
    {
        return NativeInterop.MathEngine_Multiply(a, b);
    }

    /// <summary>
    /// 除法
    /// </summary>
    /// <exception cref="DivideByZeroException">当除数为零时抛出</exception>
    public double Divide(double a, double b)
    {
        var result = NativeInterop.MathEngine_Divide(a, b, out int errorCode);
        if (errorCode != 0)
        {
            throw new DivideByZeroException("Cannot divide by zero");
        }
        return result;
    }

    /// <summary>
    /// 幂运算
    /// </summary>
    public double Power(double baseValue, int exponent)
    {
        return NativeInterop.MathEngine_Power(baseValue, exponent);
    }

    /// <summary>
    /// 平方根
    /// </summary>
    /// <exception cref="ArgumentException">当输入为负数时抛出</exception>
    public double Sqrt(double value)
    {
        var result = NativeInterop.MathEngine_Sqrt(value, out int errorCode);
        if (errorCode != 0)
        {
            throw new ArgumentException("Cannot compute square root of negative number", nameof(value));
        }
        return result;
    }

    /// <summary>
    /// 绝对值
    /// </summary>
    public double Abs(double value)
    {
        return NativeInterop.MathEngine_Abs(value);
    }

    /// <summary>
    /// 向量点积
    /// </summary>
    public double DotProduct(double[] a, double[] b)
    {
        if (a == null || b == null)
            throw new ArgumentNullException();

        if (a.Length != b.Length)
            throw new ArgumentException("Vectors must have the same length");

        return NativeInterop.MathEngine_DotProduct(a, b, a.Length);
    }

    /// <summary>
    /// 向量归一化（就地修改）
    /// </summary>
    public void Normalize(double[] vec)
    {
        if (vec == null)
            throw new ArgumentNullException(nameof(vec));

        NativeInterop.MathEngine_Normalize(vec, vec.Length);
    }

    /// <summary>
    /// 矩阵乘法
    /// </summary>
    public double[,] MatrixMultiply(double[,] a, double[,] b)
    {
        if (a == null || b == null)
            throw new ArgumentNullException();

        int aRows = a.GetLength(0);
        int aCols = a.GetLength(1);
        int bRows = b.GetLength(0);
        int bCols = b.GetLength(1);

        if (aCols != bRows)
            throw new ArgumentException("Matrix dimensions are not compatible for multiplication");

        // 转换为一维数组
        var aFlat = Flatten(a);
        var bFlat = Flatten(b);
        var resultFlat = new double[aRows * bCols];

        NativeInterop.MathEngine_MatrixMultiply(aFlat, aRows, aCols, bFlat, bRows, bCols, resultFlat);

        // 转换回二维数组
        return Unflatten(resultFlat, aRows, bCols);
    }

    private static double[] Flatten(double[,] matrix)
    {
        int rows = matrix.GetLength(0);
        int cols = matrix.GetLength(1);
        var result = new double[rows * cols];

        for (int i = 0; i < rows; i++)
        {
            for (int j = 0; j < cols; j++)
            {
                result[i * cols + j] = matrix[i, j];
            }
        }

        return result;
    }

    private static double[,] Unflatten(double[] array, int rows, int cols)
    {
        var result = new double[rows, cols];

        for (int i = 0; i < rows; i++)
        {
            for (int j = 0; j < cols; j++)
            {
                result[i, j] = array[i * cols + j];
            }
        }

        return result;
    }
}
