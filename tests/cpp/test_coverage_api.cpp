#include <gtest/gtest.h>
#include "tia/coverage_api.h"

namespace tia {
namespace test {

class CoverageApiTest : public ::testing::Test {
protected:
    void SetUp() override {
        controller_ = &CoverageController::instance();
        // Reset state before each test
        if (controller_->isRecording()) {
            controller_->stopRecording();
        }
        controller_->reset();
    }

    CoverageController* controller_ = nullptr;
};

TEST_F(CoverageApiTest, SingletonInstanceReturnsSameObject) {
    auto& instance1 = CoverageController::instance();
    auto& instance2 = CoverageController::instance();
    EXPECT_EQ(&instance1, &instance2);
}

TEST_F(CoverageApiTest, InitiallyNotRecording) {
    EXPECT_FALSE(controller_->isRecording());
    EXPECT_TRUE(controller_->currentTestId().empty());
}

TEST_F(CoverageApiTest, StartRecordingSetsState) {
    // Note: This test may pass even without LLVM runtime,
    // but the actual coverage functionality won't work
    if (!controller_->isRuntimeAvailable()) {
        GTEST_SKIP() << "LLVM Profile Runtime not available";
    }

    EXPECT_TRUE(controller_->startRecording("test_001"));
    EXPECT_TRUE(controller_->isRecording());
    EXPECT_EQ(controller_->currentTestId(), "test_001");
}

TEST_F(CoverageApiTest, DoubleStartRecordingFails) {
    if (!controller_->isRuntimeAvailable()) {
        GTEST_SKIP() << "LLVM Profile Runtime not available";
    }

    EXPECT_TRUE(controller_->startRecording("test_001"));
    EXPECT_FALSE(controller_->startRecording("test_002"));
    EXPECT_EQ(controller_->currentTestId(), "test_001");
}

TEST_F(CoverageApiTest, StopRecordingClearsState) {
    if (!controller_->isRuntimeAvailable()) {
        GTEST_SKIP() << "LLVM Profile Runtime not available";
    }

    controller_->startRecording("test_001");
    EXPECT_TRUE(controller_->stopRecording());
    EXPECT_FALSE(controller_->isRecording());
}

TEST_F(CoverageApiTest, StopWithoutStartFails) {
    EXPECT_FALSE(controller_->stopRecording());
}

TEST_F(CoverageApiTest, ResetDoesNotThrow) {
    EXPECT_NO_THROW(controller_->reset());
}

} // namespace test
} // namespace tia
