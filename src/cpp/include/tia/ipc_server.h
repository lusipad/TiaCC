#pragma once

#include <string>
#include <memory>
#include <functional>
#include <thread>
#include <atomic>

namespace tia {

/**
 * @brief JSON-RPC 2.0 server for remote coverage control
 *
 * Provides a TCP-based JSON-RPC 2.0 interface for controlling coverage
 * recording from external processes (e.g., Lua test framework).
 *
 * Supported RPC methods:
 * - startRecording(testId, language) -> {success: bool}
 * - stopRecording(testId) -> {success: bool}
 * - dumpCoverage(testId, outputPath) -> {success: bool, outputFile: string}
 * - resetAll() -> {success: bool}
 * - getStatus() -> {recording: bool, testId: string, runtimeAvailable: bool}
 *
 * Default port: 19840
 */
class IpcServer {
public:
    /**
     * @brief Configuration for the IPC server
     */
    struct Config {
        std::string host = "127.0.0.1";
        uint16_t port = 19840;
        size_t maxConnections = 10;
        int timeoutMs = 5000;
    };

    /**
     * @brief Construct a new IPC server
     *
     * @param config Server configuration
     */
    explicit IpcServer(const Config& config = Config{});

    ~IpcServer();

    // Non-copyable
    IpcServer(const IpcServer&) = delete;
    IpcServer& operator=(const IpcServer&) = delete;

    /**
     * @brief Start the server (blocking)
     *
     * Blocks until stop() is called from another thread.
     *
     * @return true if server started successfully
     * @return false if failed to bind or other error
     */
    bool run();

    /**
     * @brief Start the server in a background thread
     *
     * @return true if server thread started successfully
     */
    bool startAsync();

    /**
     * @brief Stop the server
     *
     * Thread-safe. Can be called from any thread.
     */
    void stop();

    /**
     * @brief Check if server is running
     */
    bool isRunning() const;

    /**
     * @brief Get the actual port the server is listening on
     *
     * Useful when port 0 was specified to get a random available port.
     */
    uint16_t getPort() const;

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace tia
