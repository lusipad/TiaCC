#pragma once

#include <string>
#include <memory>
#include <mutex>
#include <atomic>

namespace tia {

/**
 * @brief Controller for LLVM Profile Runtime coverage instrumentation
 *
 * This class provides a high-level interface to control code coverage
 * recording at runtime. It wraps the LLVM Profile Runtime API to support:
 * - Starting/stopping coverage recording
 * - Resetting coverage counters
 * - Dumping coverage data to files
 *
 * Thread-safe: All public methods are safe to call from multiple threads.
 *
 * Usage:
 * @code
 *   auto& controller = tia::CoverageController::instance();
 *   controller.reset();
 *   controller.startRecording("test_001");
 *   // ... run test code ...
 *   controller.stopRecording();
 *   controller.dumpToFile("coverage_data/test_001.profraw");
 * @endcode
 */
class CoverageController {
public:
    /**
     * @brief Get the singleton instance
     */
    static CoverageController& instance();

    // Non-copyable and non-movable
    CoverageController(const CoverageController&) = delete;
    CoverageController& operator=(const CoverageController&) = delete;
    CoverageController(CoverageController&&) = delete;
    CoverageController& operator=(CoverageController&&) = delete;

    /**
     * @brief Reset all coverage counters to zero
     *
     * Clears all accumulated coverage data. Call this before starting
     * a new recording session to ensure clean data.
     */
    void reset();

    /**
     * @brief Start recording coverage for a test
     *
     * @param testId Unique identifier for the test being recorded
     * @return true if recording started successfully
     * @return false if already recording or initialization failed
     */
    bool startRecording(const std::string& testId);

    /**
     * @brief Stop the current recording session
     *
     * @return true if recording stopped successfully
     * @return false if not currently recording
     */
    bool stopRecording();

    /**
     * @brief Dump accumulated coverage data to a file
     *
     * @param outputPath Path to write the .profraw file
     * @return true if dump succeeded
     * @return false if write failed or no data available
     */
    bool dumpToFile(const std::string& outputPath);

    /**
     * @brief Check if currently recording
     */
    bool isRecording() const;

    /**
     * @brief Get the ID of the current test being recorded
     *
     * @return Test ID string, or empty if not recording
     */
    std::string currentTestId() const;

    /**
     * @brief Check if LLVM Profile Runtime is available
     *
     * @return true if the runtime was linked and initialized
     */
    bool isRuntimeAvailable() const;

private:
    CoverageController();
    ~CoverageController();

    // LLVM Profile Runtime wrappers
    void llvmProfileReset();
    int llvmProfileWrite(const std::string& path);
    void llvmProfileSetFilename(const std::string& path);

    // State
    mutable std::mutex mutex_;
    std::atomic<bool> recording_{false};
    std::string currentTestId_;
    bool runtimeAvailable_{false};
};

} // namespace tia
