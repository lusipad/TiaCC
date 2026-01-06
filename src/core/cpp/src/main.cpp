#include "tia/ipc_server.h"
#include "tia/coverage_api.h"

#include <iostream>
#include <string>
#include <csignal>
#include <cstdlib>

namespace {
    tia::IpcServer* g_server = nullptr;

    void signalHandler(int signal) {
        std::cout << "\n[TiaCC] Received signal " << signal << ", shutting down...\n";
        if (g_server) {
            g_server->stop();
        }
    }

    void printUsage(const char* program) {
        std::cout << "TiaCC Coverage Service\n"
                  << "Usage: " << program << " [options]\n\n"
                  << "Options:\n"
                  << "  -h, --help         Show this help message\n"
                  << "  -p, --port PORT    Server port (default: 19840)\n"
                  << "  --host HOST        Bind address (default: 127.0.0.1)\n"
                  << "\n";
    }
}

int main(int argc, char* argv[]) {
    tia::IpcServer::Config config;

    // Parse command line arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if (arg == "-h" || arg == "--help") {
            printUsage(argv[0]);
            return 0;
        }
        else if ((arg == "-p" || arg == "--port") && i + 1 < argc) {
            config.port = static_cast<uint16_t>(std::stoi(argv[++i]));
        }
        else if (arg == "--host" && i + 1 < argc) {
            config.host = argv[++i];
        }
        else {
            std::cerr << "Unknown argument: " << arg << "\n";
            printUsage(argv[0]);
            return 1;
        }
    }

    // Check runtime availability
    auto& controller = tia::CoverageController::instance();
    if (controller.isRuntimeAvailable()) {
        std::cout << "[TiaCC] LLVM Profile Runtime: Available\n";
    } else {
        std::cout << "[TiaCC] LLVM Profile Runtime: Not available (coverage will not work)\n";
    }

    // Setup signal handlers
    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    // Start server
    tia::IpcServer server(config);
    g_server = &server;

    std::cout << "[TiaCC] Starting coverage service...\n";

    if (!server.run()) {
        std::cerr << "[TiaCC] Failed to start server\n";
        return 1;
    }

    std::cout << "[TiaCC] Server stopped\n";
    return 0;
}
