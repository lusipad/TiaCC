using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using TiaCC.Coverage;

namespace TiaCC.CoverageService;

/// <summary>
/// Standalone coverage service that provides JSON-RPC interface for .NET coverage control.
/// </summary>
public class Program
{
    public static async Task Main(string[] args)
    {
        var host = "127.0.0.1";
        var port = 19841; // Different from C++ service (19840)
        var outputDir = "coverage_data";

        // Parse arguments
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "-p" or "--port" when i + 1 < args.Length:
                    port = int.Parse(args[++i]);
                    break;
                case "--host" when i + 1 < args.Length:
                    host = args[++i];
                    break;
                case "-o" or "--output" when i + 1 < args.Length:
                    outputDir = args[++i];
                    break;
                case "-h" or "--help":
                    PrintUsage();
                    return;
            }
        }

        using var loggerFactory = LoggerFactory.Create(builder =>
        {
            builder.AddConsole();
            builder.SetMinimumLevel(LogLevel.Information);
        });

        var logger = loggerFactory.CreateLogger<Program>();
        var controllerLogger = loggerFactory.CreateLogger<CoverageController>();

        logger.LogInformation("TiaCC .NET Coverage Service starting...");

        using var controller = new CoverageController(outputDir, controllerLogger);
        using var server = new RpcServer(host, port, controller, logger);

        var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
            logger.LogInformation("Shutdown requested...");
        };

        await server.RunAsync(cts.Token);
    }

    private static void PrintUsage()
    {
        Console.WriteLine("""
            TiaCC .NET Coverage Service
            Usage: TiaCC.CoverageService [options]

            Options:
              -h, --help         Show this help message
              -p, --port PORT    Server port (default: 19841)
              --host HOST        Bind address (default: 127.0.0.1)
              -o, --output DIR   Coverage output directory (default: coverage_data)
            """);
    }
}

/// <summary>
/// Simple JSON-RPC 2.0 TCP server.
/// </summary>
internal class RpcServer : IDisposable
{
    private readonly TcpListener _listener;
    private readonly CoverageController _controller;
    private readonly ILogger _logger;

    public RpcServer(string host, int port, CoverageController controller, ILogger logger)
    {
        _listener = new TcpListener(IPAddress.Parse(host), port);
        _controller = controller;
        _logger = logger;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        _listener.Start();
        _logger.LogInformation("Server listening on {Endpoint}", _listener.LocalEndpoint);

        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var client = await _listener.AcceptTcpClientAsync(cancellationToken);
                _ = HandleClientAsync(client, cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Server stopped");
        }
    }

    private async Task HandleClientAsync(TcpClient client, CancellationToken cancellationToken)
    {
        using (client)
        await using (var stream = client.GetStream())
        using (var reader = new StreamReader(stream, Encoding.UTF8))
        await using (var writer = new StreamWriter(stream, Encoding.UTF8) { AutoFlush = true })
        {
            try
            {
                while (!cancellationToken.IsCancellationRequested)
                {
                    var line = await reader.ReadLineAsync(cancellationToken);
                    if (line == null) break;

                    var response = ProcessRequest(line);
                    await writer.WriteLineAsync(response);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Client handler error");
            }
        }
    }

    private string ProcessRequest(string requestJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(requestJson);
            var root = doc.RootElement;

            var method = root.GetProperty("method").GetString() ?? "";
            var id = root.TryGetProperty("id", out var idProp) ? idProp.Clone() : default;
            var paramsEl = root.TryGetProperty("params", out var p) ? p : default;

            var result = method switch
            {
                "startRecording" => HandleStartRecording(paramsEl),
                "stopRecording" => HandleStopRecording(),
                "dumpCoverage" => HandleDumpCoverage(paramsEl),
                "resetAll" => HandleResetAll(),
                "getStatus" => HandleGetStatus(),
                _ => throw new Exception($"Unknown method: {method}")
            };

            return JsonSerializer.Serialize(new { jsonrpc = "2.0", result, id });
        }
        catch (JsonException)
        {
            return JsonSerializer.Serialize(new
            {
                jsonrpc = "2.0",
                error = new { code = -32700, message = "Parse error" },
                id = (object?)null
            });
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new
            {
                jsonrpc = "2.0",
                error = new { code = -32603, message = ex.Message },
                id = (object?)null
            });
        }
    }

    private object HandleStartRecording(JsonElement paramsEl)
    {
        var testId = paramsEl.GetProperty("testId").GetString() ?? "";
        var success = _controller.StartRecording(testId);
        return new { success };
    }

    private object HandleStopRecording()
    {
        var success = _controller.StopRecording();
        return new { success };
    }

    private object HandleDumpCoverage(JsonElement paramsEl)
    {
        string? outputPath = null;
        if (paramsEl.TryGetProperty("outputPath", out var pathProp))
        {
            outputPath = pathProp.GetString();
        }
        var actualPath = _controller.DumpToFile(outputPath);
        return new { success = actualPath != null, outputFile = actualPath };
    }

    private object HandleResetAll()
    {
        // For .NET, we just reset state (coverlet handles actual reset)
        if (_controller.IsRecording)
        {
            _controller.StopRecording();
        }
        return new { success = true };
    }

    private object HandleGetStatus()
    {
        return new
        {
            recording = _controller.IsRecording,
            testId = _controller.CurrentTestId ?? "",
            runtimeAvailable = true
        };
    }

    public void Dispose()
    {
        _listener.Stop();
    }
}
