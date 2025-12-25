using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace TiaCC.Coverage;

/// <summary>
/// JSON-RPC 2.0 client for communicating with the TiaCC coverage service.
/// </summary>
public class IpcClient : IDisposable
{
    private readonly string _host;
    private readonly int _port;
    private readonly int _timeoutMs;
    private readonly ILogger<IpcClient> _logger;

    private TcpClient? _client;
    private NetworkStream? _stream;
    private StreamReader? _reader;
    private StreamWriter? _writer;
    private int _requestId;
    private bool _disposed;

    public IpcClient(
        string host = "127.0.0.1",
        int port = 19840,
        int timeoutMs = 5000,
        ILogger<IpcClient>? logger = null)
    {
        _host = host;
        _port = port;
        _timeoutMs = timeoutMs;
        _logger = logger ?? NullLogger<IpcClient>.Instance;
    }

    /// <summary>
    /// Gets whether the client is connected to the server.
    /// </summary>
    public bool IsConnected => _client?.Connected ?? false;

    /// <summary>
    /// Connects to the coverage service.
    /// </summary>
    /// <returns>True if connection succeeded</returns>
    public async Task<bool> ConnectAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            _client = new TcpClient();
            _client.ReceiveTimeout = _timeoutMs;
            _client.SendTimeout = _timeoutMs;

            await _client.ConnectAsync(_host, _port, cancellationToken);

            _stream = _client.GetStream();
            _reader = new StreamReader(_stream, Encoding.UTF8);
            _writer = new StreamWriter(_stream, Encoding.UTF8) { AutoFlush = true };

            _logger.LogInformation("Connected to coverage service at {Host}:{Port}", _host, _port);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to connect to coverage service at {Host}:{Port}", _host, _port);
            Disconnect();
            return false;
        }
    }

    /// <summary>
    /// Disconnects from the coverage service.
    /// </summary>
    public void Disconnect()
    {
        _writer?.Dispose();
        _reader?.Dispose();
        _stream?.Dispose();
        _client?.Dispose();

        _writer = null;
        _reader = null;
        _stream = null;
        _client = null;
    }

    /// <summary>
    /// Starts recording coverage for a test.
    /// </summary>
    public async Task<RpcResult> StartRecordingAsync(string testId, string language = "csharp")
    {
        return await SendRequestAsync("startRecording", new
        {
            testId,
            language
        });
    }

    /// <summary>
    /// Stops the current recording session.
    /// </summary>
    public async Task<RpcResult> StopRecordingAsync(string testId)
    {
        return await SendRequestAsync("stopRecording", new { testId });
    }

    /// <summary>
    /// Dumps coverage data to a file.
    /// </summary>
    public async Task<RpcResult> DumpCoverageAsync(string testId, string? outputPath = null)
    {
        var parameters = new Dictionary<string, object?> { ["testId"] = testId };
        if (outputPath != null)
        {
            parameters["outputPath"] = outputPath;
        }
        return await SendRequestAsync("dumpCoverage", parameters);
    }

    /// <summary>
    /// Resets all coverage counters.
    /// </summary>
    public async Task<RpcResult> ResetAllAsync()
    {
        return await SendRequestAsync("resetAll", null);
    }

    /// <summary>
    /// Gets the current status of the coverage service.
    /// </summary>
    public async Task<RpcResult> GetStatusAsync()
    {
        return await SendRequestAsync("getStatus", null);
    }

    private async Task<RpcResult> SendRequestAsync(string method, object? parameters)
    {
        if (!IsConnected)
        {
            return new RpcResult { Success = false, Error = "Not connected" };
        }

        try
        {
            var request = new JsonRpcRequest
            {
                JsonRpc = "2.0",
                Method = method,
                Params = parameters,
                Id = Interlocked.Increment(ref _requestId)
            };

            var requestJson = JsonSerializer.Serialize(request, JsonOptions);
            _logger.LogDebug("Sending RPC request: {Method}", method);

            await _writer!.WriteLineAsync(requestJson);

            var responseJson = await _reader!.ReadLineAsync();
            if (string.IsNullOrEmpty(responseJson))
            {
                return new RpcResult { Success = false, Error = "Empty response" };
            }

            var response = JsonSerializer.Deserialize<JsonRpcResponse>(responseJson, JsonOptions);
            if (response == null)
            {
                return new RpcResult { Success = false, Error = "Failed to parse response" };
            }

            if (response.Error != null)
            {
                return new RpcResult
                {
                    Success = false,
                    Error = response.Error.Message
                };
            }

            return new RpcResult
            {
                Success = true,
                Data = response.Result
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "RPC request failed: {Method}", method);
            return new RpcResult { Success = false, Error = ex.Message };
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public void Dispose()
    {
        if (!_disposed)
        {
            Disconnect();
            _disposed = true;
        }
        GC.SuppressFinalize(this);
    }
}

/// <summary>
/// Result of an RPC call.
/// </summary>
public class RpcResult
{
    public bool Success { get; init; }
    public string? Error { get; init; }
    public JsonElement? Data { get; init; }

    public T? GetData<T>()
    {
        if (Data == null) return default;
        return JsonSerializer.Deserialize<T>(Data.Value.GetRawText());
    }
}

internal class JsonRpcRequest
{
    public string JsonRpc { get; init; } = "2.0";
    public required string Method { get; init; }
    public object? Params { get; init; }
    public int Id { get; init; }
}

internal class JsonRpcResponse
{
    public string JsonRpc { get; init; } = "2.0";
    public JsonElement? Result { get; init; }
    public JsonRpcError? Error { get; init; }
    public int? Id { get; init; }
}

internal class JsonRpcError
{
    public int Code { get; init; }
    public string Message { get; init; } = "";
}
