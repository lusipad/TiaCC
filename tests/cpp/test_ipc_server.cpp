#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include "tia/ipc_server.h"

#include <asio.hpp>
#include <nlohmann/json.hpp>
#include <thread>
#include <chrono>

using asio::ip::tcp;
using json = nlohmann::json;

namespace tia {
namespace test {

class IpcServerTest : public ::testing::Test {
protected:
    void SetUp() override {
        // Use port 0 to get a random available port
        config_.port = 0;
        config_.host = "127.0.0.1";
    }

    void TearDown() override {
        if (server_) {
            server_->stop();
            server_.reset();
        }
    }

    std::string sendRequest(const json& request) {
        asio::io_context io;
        tcp::socket socket(io);
        tcp::resolver resolver(io);

        auto endpoints = resolver.resolve(
            config_.host,
            std::to_string(server_->getPort())
        );
        asio::connect(socket, endpoints);

        std::string requestStr = request.dump() + "\n";
        asio::write(socket, asio::buffer(requestStr));

        asio::streambuf response;
        asio::read_until(socket, response, '\n');

        std::istream stream(&response);
        std::string line;
        std::getline(stream, line);
        return line;
    }

    IpcServer::Config config_;
    std::unique_ptr<IpcServer> server_;
};

TEST_F(IpcServerTest, ServerStartsAndStops) {
    server_ = std::make_unique<IpcServer>(config_);
    EXPECT_TRUE(server_->startAsync());
    EXPECT_TRUE(server_->isRunning());
    EXPECT_GT(server_->getPort(), 0);

    server_->stop();
    // Give it a moment to fully stop
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    EXPECT_FALSE(server_->isRunning());
}

TEST_F(IpcServerTest, GetStatusReturnsValidResponse) {
    server_ = std::make_unique<IpcServer>(config_);
    ASSERT_TRUE(server_->startAsync());

    // Wait for server to be ready
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    json request = {
        {"jsonrpc", "2.0"},
        {"method", "getStatus"},
        {"id", 1}
    };

    std::string responseStr = sendRequest(request);
    json response = json::parse(responseStr);

    EXPECT_EQ(response["jsonrpc"], "2.0");
    EXPECT_EQ(response["id"], 1);
    EXPECT_TRUE(response.contains("result"));
    EXPECT_TRUE(response["result"].contains("recording"));
    EXPECT_TRUE(response["result"].contains("runtimeAvailable"));
}

TEST_F(IpcServerTest, ResetAllReturnsSuccess) {
    server_ = std::make_unique<IpcServer>(config_);
    ASSERT_TRUE(server_->startAsync());
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    json request = {
        {"jsonrpc", "2.0"},
        {"method", "resetAll"},
        {"id", 2}
    };

    std::string responseStr = sendRequest(request);
    json response = json::parse(responseStr);

    EXPECT_EQ(response["result"]["success"], true);
}

TEST_F(IpcServerTest, InvalidMethodReturnsError) {
    server_ = std::make_unique<IpcServer>(config_);
    ASSERT_TRUE(server_->startAsync());
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    json request = {
        {"jsonrpc", "2.0"},
        {"method", "nonExistentMethod"},
        {"id", 3}
    };

    std::string responseStr = sendRequest(request);
    json response = json::parse(responseStr);

    EXPECT_TRUE(response.contains("error"));
}

TEST_F(IpcServerTest, InvalidJsonReturnsParseError) {
    server_ = std::make_unique<IpcServer>(config_);
    ASSERT_TRUE(server_->startAsync());
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    asio::io_context io;
    tcp::socket socket(io);
    tcp::resolver resolver(io);
    auto endpoints = resolver.resolve(config_.host, std::to_string(server_->getPort()));
    asio::connect(socket, endpoints);

    std::string invalidJson = "not valid json\n";
    asio::write(socket, asio::buffer(invalidJson));

    asio::streambuf response;
    asio::read_until(socket, response, '\n');

    std::istream stream(&response);
    std::string line;
    std::getline(stream, line);

    json responseJson = json::parse(line);
    EXPECT_TRUE(responseJson.contains("error"));
    EXPECT_EQ(responseJson["error"]["code"], -32700); // Parse error
}

} // namespace test
} // namespace tia
