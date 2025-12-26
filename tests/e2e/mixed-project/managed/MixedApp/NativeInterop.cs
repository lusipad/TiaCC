using System.Runtime.InteropServices;

namespace MixedApp;

/// <summary>
/// P/Invoke 声明，用于调用 C++ 原生库
/// </summary>
public static class NativeInterop
{
    private const string NativeLibName = "native_lib";

    #region Math Engine

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern double MathEngine_Add(double a, double b);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern double MathEngine_Subtract(double a, double b);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern double MathEngine_Multiply(double a, double b);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern double MathEngine_Divide(double a, double b, out int errorCode);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern double MathEngine_Power(double baseValue, int exponent);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern double MathEngine_Sqrt(double value, out int errorCode);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern double MathEngine_Abs(double value);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern double MathEngine_DotProduct(double[] a, double[] b, int length);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern void MathEngine_Normalize(double[] vec, int length);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern void MathEngine_MatrixMultiply(
        double[] a, int aRows, int aCols,
        double[] b, int bRows, int bCols,
        double[] result);

    #endregion

    #region String Processor

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern int StringProcessor_GetLength(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string str);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern void StringProcessor_ToUpperCase(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string input,
        [MarshalAs(UnmanagedType.LPArray)] byte[] output,
        int maxLen);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern void StringProcessor_ToLowerCase(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string input,
        [MarshalAs(UnmanagedType.LPArray)] byte[] output,
        int maxLen);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern int StringProcessor_Contains(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string haystack,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string needle);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern int StringProcessor_IndexOf(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string haystack,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string needle);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern int StringProcessor_StartsWith(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string str,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string prefix);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern int StringProcessor_EndsWith(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string str,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string suffix);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern void StringProcessor_Concat(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string a,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string b,
        [MarshalAs(UnmanagedType.LPArray)] byte[] output,
        int maxLen);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern void StringProcessor_Trim(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string input,
        [MarshalAs(UnmanagedType.LPArray)] byte[] output,
        int maxLen);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern void StringProcessor_Reverse(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string input,
        [MarshalAs(UnmanagedType.LPArray)] byte[] output,
        int maxLen);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern int StringProcessor_ToInt(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string str,
        out int errorCode);

    [DllImport(NativeLibName, CallingConvention = CallingConvention.Cdecl)]
    public static extern double StringProcessor_ToDouble(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string str,
        out int errorCode);

    #endregion
}
