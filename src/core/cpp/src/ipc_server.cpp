#include "tia/ipc_server.h"
#include "tia/coverage_api.h"

#include <asio.hpp>
#include <nlohmann/json.hpp>
#include <iostream>
#include <sstream>

using asio::ip::tcp;
using json = nlohmann::json;

namespace tia {

class IpcServer::Impl {
public:
    explicit Impl(const Config& config)
        : config_(config)
        , acceptor_(ioContext_)
        , running_(false)
    {
    }

    ~Impl() {
        stop();
    }

    bool run() {
        try {
            setupAcceptor();
            running_ = true;
            startAccept();
            ioContext_.run();
            return true;
        } catch (const std::exception& e) {
            std::cerr << "[TiaCC IPC] Error: " << e.what() << "\n";
            return false;
        }
    }

    bool startAsync() {
        try {
            setupAcceptor();
            running_ = true;
            startAccept();
            serverThread_ = std::thread([this]() {
                ioContext_.run();
            });
            return true;
        } catch (const std::exception& e) {
            std::cerr << "[TiaCC IPC] Error: " << e.what() << "\n";
            return false;
        }
    }

    void stop() {
        if (running_) {
            running_ = false;
            ioContext_.stop();
            if (serverThread_.joinable()) {
                serverThread_.join();
            }
        }
    }

    bool isRunning() const {
        return running_;
    }

    uint16_t getPort() const {
        return actualPort_;
    }

private:
    void setupAcceptor() {
        tcp::endpoint endpoint(
            asio::ip::make_address(config_.host),
            config_.port
        );
        acceptor_.open(endpoint.protocol());
        acceptor_.set_option(asio::socket_base::reuse_address(true));
        acceptor_.bind(endpoint);
        acceptor_.listen(static_cast<int>(config_.maxConnections));
        actualPort_ = acceptor_.local_endpoint().port();

        std::cout << "[TiaCC IPC] Server listening on "
                  << config_.host << ":" << actualPort_ << "\n";
    }

    void startAccept() {
        auto socket = std::make_shared<tcp::socket>(ioContext_);
        acceptor_.async_accept(*socket,
            [this, socket](const asio::error_code& error) {
                if (!error && running_) {
                    handleConnection(socket);
                }
                if (running_) {
                    startAccept();
                }
            });
    }

    void handleConnection(std::shared_ptr<tcp::socket> socket) {
        auto buffer = std::make_shared<asio::streambuf>();

        asio::async_read_until(*socket, *buffer, '\n',
            [this, socket, buffer](const asio::error_code& error, size_t) {
                if (error) {
                    return;
                }

                std::istream stream(buffer.get());
                std::string line;
                std::getline(stream, line);

                std::string response = processRequest(line);

                auto responsePtr = std::make_shared<std::string>(response + "\n");
                asio::async_write(*socket, asio::buffer(*responsePtr),
                    [socket, responsePtr](const asio::error_code&, size_t) {
                        // Response sent, connection can be reused or closed
                    });

                // Continue reading if connection is kept alive
                handleConnection(socket);
            });
    }

    std::string processRequest(const std::string& requestStr) {
        try {
            json request = json::parse(requestStr);

            // Validate JSON-RPC 2.0 format
            if (!request.contains("jsonrpc") || request["jsonrpc"] != "2.0") {
                return createErrorResponse(-32600, "Invalid JSON-RPC version", nullptr);
            }

            if (!request.contains("method")) {
                return createErrorResponse(-32600, "Missing method", request.value("id", nullptr));
            }

            std::string method = request["method"];
            json params = request.value("params", json::object());
            json id = request.value("id", nullptr);

            json result = dispatchMethod(method, params);

            return createSuccessResponse(result, id);

        } catch (const json::parse_error& e) {
            return createErrorResponse(-32700, "Parse error", nullptr);
        } catch (const std::exception& e) {
            return createErrorResponse(-32603, e.what(), nullptr);
        }
    }

    json dispatchMethod(const std::string& method, const json& params) {
        auto& controller = CoverageController::instance();

        if (method == "startRecording") {
            std::string testId = params.value("testId", "");
            if (testId.empty()) {
                throw std::runtime_error("testId is required");
            }
            bool success = controller.startRecording(testId);
            return {{"success", success}};
        }
        else if (method == "stopRecording") {
            bool success = controller.stopRecording();
            return {{"success", success}};
        }
        else if (method == "dumpCoverage") {
            std::string testId = params.value("testId", "");
            std::string outputPath = params.value("outputPath", "");
            if (outputPath.empty()) {
                // Generate default path
                outputPath = "coverage_data/" + testId + ".profraw";
            }
            bool success = controller.dumpToFile(outputPath);
            return {{"success", success}, {"outputFile", outputPath}};
        }
        else if (method == "resetAll") {
            controller.reset();
            return {{"success", true}};
        }
        else if (method == "getStatus") {
            return {
                {"recording", controller.isRecording()},
                {"testId", controller.currentTestId()},
                {"runtimeAvailable", controller.isRuntimeAvailable()}
            };
        }
        else {
            throw std::runtime_error("Unknown method: " + method);
        }
    }

    std::string createSuccessResponse(const json& result, const json& id) {
        json response = {
            {"jsonrpc", "2.0"},
            {"result", result},
            {"id", id}
        };
        return response.dump();
    }

    std::string createErrorResponse(int code, const std::string& message, const json& id) {
        json response = {
            {"jsonrpc", "2.0"},
            {"error", {
                {"code", code},
                {"message", message}
            }},
            {"id", id}
        };
        return response.dump();
    }

    Config config_;
    asio::io_context ioContext_;
    tcp::acceptor acceptor_;
    std::atomic<bool> running_;
    std::thread serverThread_;
    uint16_t actualPort_ = 0;
};

IpcServer::IpcServer(const Config& config)
    : impl_(std::make_unique<Impl>(config))
{
}

IpcServer::~IpcServer() = default;

bool IpcServer::run() {
    return impl_->run();
}

bool IpcServer::startAsync() {
    return impl_->startAsync();
}

void IpcServer::stop() {
    impl_->stop();
}

bool IpcServer::isRunning() const {
    return impl_->isRunning();
}

uint16_t IpcServer::getPort() const {
    return impl_->getPort();
}

} // namespace tia
