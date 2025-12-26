using System.Text;

namespace MixedApp;

/// <summary>
/// 字符串服务 - 封装原生字符串处理器的高级接口
/// </summary>
public class StringService
{
    private const int MaxBufferSize = 1024;

    /// <summary>
    /// 获取字符串长度
    /// </summary>
    public int GetLength(string str)
    {
        if (str == null)
            throw new ArgumentNullException(nameof(str));

        return NativeInterop.StringProcessor_GetLength(str);
    }

    /// <summary>
    /// 转换为大写
    /// </summary>
    public string ToUpperCase(string input)
    {
        if (input == null)
            throw new ArgumentNullException(nameof(input));

        var buffer = new byte[MaxBufferSize];
        NativeInterop.StringProcessor_ToUpperCase(input, buffer, MaxBufferSize);
        return GetStringFromBuffer(buffer);
    }

    /// <summary>
    /// 转换为小写
    /// </summary>
    public string ToLowerCase(string input)
    {
        if (input == null)
            throw new ArgumentNullException(nameof(input));

        var buffer = new byte[MaxBufferSize];
        NativeInterop.StringProcessor_ToLowerCase(input, buffer, MaxBufferSize);
        return GetStringFromBuffer(buffer);
    }

    /// <summary>
    /// 检查是否包含子字符串
    /// </summary>
    public bool Contains(string haystack, string needle)
    {
        if (haystack == null || needle == null)
            throw new ArgumentNullException();

        return NativeInterop.StringProcessor_Contains(haystack, needle) != 0;
    }

    /// <summary>
    /// 查找子字符串位置
    /// </summary>
    public int IndexOf(string haystack, string needle)
    {
        if (haystack == null || needle == null)
            throw new ArgumentNullException();

        return NativeInterop.StringProcessor_IndexOf(haystack, needle);
    }

    /// <summary>
    /// 检查是否以指定前缀开头
    /// </summary>
    public bool StartsWith(string str, string prefix)
    {
        if (str == null || prefix == null)
            throw new ArgumentNullException();

        return NativeInterop.StringProcessor_StartsWith(str, prefix) != 0;
    }

    /// <summary>
    /// 检查是否以指定后缀结尾
    /// </summary>
    public bool EndsWith(string str, string suffix)
    {
        if (str == null || suffix == null)
            throw new ArgumentNullException();

        return NativeInterop.StringProcessor_EndsWith(str, suffix) != 0;
    }

    /// <summary>
    /// 连接字符串
    /// </summary>
    public string Concat(string a, string b)
    {
        if (a == null || b == null)
            throw new ArgumentNullException();

        var buffer = new byte[MaxBufferSize];
        NativeInterop.StringProcessor_Concat(a, b, buffer, MaxBufferSize);
        return GetStringFromBuffer(buffer);
    }

    /// <summary>
    /// 去除首尾空白
    /// </summary>
    public string Trim(string input)
    {
        if (input == null)
            throw new ArgumentNullException(nameof(input));

        var buffer = new byte[MaxBufferSize];
        NativeInterop.StringProcessor_Trim(input, buffer, MaxBufferSize);
        return GetStringFromBuffer(buffer);
    }

    /// <summary>
    /// 反转字符串
    /// </summary>
    public string Reverse(string input)
    {
        if (input == null)
            throw new ArgumentNullException(nameof(input));

        var buffer = new byte[MaxBufferSize];
        NativeInterop.StringProcessor_Reverse(input, buffer, MaxBufferSize);
        return GetStringFromBuffer(buffer);
    }

    /// <summary>
    /// 解析整数
    /// </summary>
    public int ParseInt(string str)
    {
        if (str == null)
            throw new ArgumentNullException(nameof(str));

        var result = NativeInterop.StringProcessor_ToInt(str, out int errorCode);
        if (errorCode != 0)
        {
            throw new FormatException($"Cannot parse '{str}' as integer");
        }
        return result;
    }

    /// <summary>
    /// 解析浮点数
    /// </summary>
    public double ParseDouble(string str)
    {
        if (str == null)
            throw new ArgumentNullException(nameof(str));

        var result = NativeInterop.StringProcessor_ToDouble(str, out int errorCode);
        if (errorCode != 0)
        {
            throw new FormatException($"Cannot parse '{str}' as double");
        }
        return result;
    }

    private static string GetStringFromBuffer(byte[] buffer)
    {
        int length = Array.IndexOf(buffer, (byte)0);
        if (length < 0) length = buffer.Length;
        return Encoding.UTF8.GetString(buffer, 0, length);
    }
}
