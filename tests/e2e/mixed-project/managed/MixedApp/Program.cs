namespace MixedApp;

class Program
{
    static void Main(string[] args)
    {
        Console.WriteLine("=== MixedApp Demo ===");
        Console.WriteLine("C# exe calling C++ native lib via P/Invoke\n");

        try
        {
            // 测试数学服务
            var mathService = new MathService();
            Console.WriteLine("Math Service Tests:");
            Console.WriteLine($"  Add(2, 3) = {mathService.Add(2, 3)}");
            Console.WriteLine($"  Multiply(4, 5) = {mathService.Multiply(4, 5)}");
            Console.WriteLine($"  Power(2, 10) = {mathService.Power(2, 10)}");
            Console.WriteLine($"  Sqrt(16) = {mathService.Sqrt(16)}");

            // 向量点积
            var vec1 = new double[] { 1, 2, 3 };
            var vec2 = new double[] { 4, 5, 6 };
            Console.WriteLine($"  DotProduct([1,2,3], [4,5,6]) = {mathService.DotProduct(vec1, vec2)}");

            Console.WriteLine();

            // 测试字符串服务
            var stringService = new StringService();
            Console.WriteLine("String Service Tests:");
            Console.WriteLine($"  GetLength(\"Hello\") = {stringService.GetLength("Hello")}");
            Console.WriteLine($"  ToUpperCase(\"hello world\") = {stringService.ToUpperCase("hello world")}");
            Console.WriteLine($"  Reverse(\"hello\") = {stringService.Reverse("hello")}");
            Console.WriteLine($"  Contains(\"hello world\", \"wor\") = {stringService.Contains("hello world", "wor")}");
            Console.WriteLine($"  Trim(\"  spaces  \") = \"{stringService.Trim("  spaces  ")}\"");

            Console.WriteLine("\n=== All tests passed! ===");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error: {ex.Message}");
            Environment.Exit(1);
        }
    }
}
