/*
 * TiaCC C# Client - 测试框架集成钩子
 *
 * Usage:
 *     using var hooks = new TiaHooks();
 *     await hooks.ConnectAsync();
 *
 *     foreach (var test in tests)
 *     {
 *         await hooks.BeforeTestAsync(test.Name);
 *         await RunTestAsync(test);
 *         await hooks.AfterTestAsync(test.Name);
 *     }
 */

using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TiaCC.Client;

public class TiaConfig
{
    public string Host { get; set; } = "127.0.0.1";
    public int Port { get; set; } = 19840;
    public int TimeoutMs { get; set; } = 5000;
    public string Mode { get; set; } = "precise"; // "precise" or "bucket"
    public int BucketSize { get; set; } = 50;
    public string Language { get; set; } = "csharp";
}

public class TiaHooks : IDisposable
{
    private readonly TiaConfig _config;
    private TcpClient? _client;
    private StreamReader? _reader;
    private StreamWriter? _writer;
    private int _requestId;
    private int _bucketCount;
    private readonly List<string> _bucketTests = new();

    public TiaHooks(TiaConfig? config = null)
    {
        _config = config ?? new TiaConfig();
    }

    public async Task<bool> ConnectAsync(CancellationToken ct = default)
    {
        try
        {
            _client = new TcpClient();
            _client.ReceiveTimeout = _config.TimeoutMs;
            _client.SendTimeout = _config.TimeoutMs;

            await _client.ConnectAsync(_config.Host, _config.Port, ct);

            var stream = _client.GetStream();
            _reader = new StreamReader(stream, Encoding.UTF8);
            _writer = new StreamWriter(stream, Encoding.UTF8) { AutoFlush = true };

            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[TiaCC] 连接失败: {ex.Message}");
            return false;
        }
    }

    public void Disconnect()
    {
        _writer?.Dispose();
        _reader?.Dispose();
        _client?.Dispose();
        _client = null;
    }

    private async Task<JsonElement?> SendRpcAsync(string method, object? parameters = null)
    {
        if (_writer == null || _reader == null) return null;

        var request = new
        {
            jsonrpc = "2.0",
            method,
            @params = parameters ?? new { },
            id = ++_requestId
        };

        try
        {
            var json = JsonSerializer.Serialize(request);
            await _writer.WriteLineAsync(json);

            var response = await _reader.ReadLineAsync();
            if (string.IsNullOrEmpty(response)) return null;

            using var doc = JsonDocument.Parse(response);
            if (doc.RootElement.TryGetProperty("result", out var result))
            {
                return result.Clone();
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[TiaCC] RPC 错误: {ex.Message}");
        }

        return null;
    }

    public async Task<bool> StartRecordingAsync(string testId)
    {
        var result = await SendRpcAsync("startRecording", new
        {
            testId,
            language = _config.Language
        });
        return result?.GetProperty("success").GetBoolean() ?? false;
    }

    public async Task<bool> StopRecordingAsync(string testId)
    {
        var result = await SendRpcAsync("stopRecording", new { testId });
        return result?.GetProperty("success").GetBoolean() ?? false;
    }

    public async Task<bool> DumpCoverageAsync(string testId, string? outputPath = null)
    {
        var parameters = new Dictionary<string, string> { ["testId"] = testId };
        if (outputPath != null) parameters["outputPath"] = outputPath;

        var result = await SendRpcAsync("dumpCoverage", parameters);
        return result?.GetProperty("success").GetBoolean() ?? false;
    }

    public async Task<bool> ResetAllAsync()
    {
        var result = await SendRpcAsync("resetAll");
        return result?.GetProperty("success").GetBoolean() ?? false;
    }

    // 高级 API
    public async Task BeforeTestAsync(string testId)
    {
        if (_config.Mode == "precise")
        {
            await StartRecordingAsync(testId);
        }
        else
        {
            _bucketTests.Add(testId);
            _bucketCount++;
            if (_bucketCount == 1)
            {
                await StartRecordingAsync($"bucket_{_requestId / _config.BucketSize}");
            }
        }
    }

    public async Task AfterTestAsync(string testId)
    {
        if (_config.Mode == "precise")
        {
            await StopRecordingAsync(testId);
            await DumpCoverageAsync(testId);
        }
        else if (_bucketCount >= _config.BucketSize)
        {
            await FlushBucketAsync();
        }
    }

    public async Task FlushBucketAsync()
    {
        if (_bucketCount > 0)
        {
            var bucketId = $"bucket_{_requestId / _config.BucketSize}";
            await StopRecordingAsync(bucketId);
            await DumpCoverageAsync(bucketId);
            _bucketTests.Clear();
            _bucketCount = 0;
        }
    }

    public void Dispose()
    {
        Disconnect();
        GC.SuppressFinalize(this);
    }
}
