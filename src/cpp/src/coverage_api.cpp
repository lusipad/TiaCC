#include "tia/coverage_api.h"
#include "tia/platform.h"

#include <iostream>
#include <cstdlib>

#if defined(TIA_PLATFORM_WINDOWS) && !TIA_HAS_WEAK_SYMBOLS
    #include <windows.h>
#endif

// LLVM Profile Runtime API declarations
// These symbols are provided by the LLVM compiler-rt profile library
// when compiled with -fprofile-instr-generate -fcoverage-mapping

#if TIA_HAS_WEAK_SYMBOLS
// For Clang/GCC: use weak symbols
extern "C" {
    void __llvm_profile_reset_counters(void) TIA_WEAK_SYMBOL;
    int __llvm_profile_write_file(void) TIA_WEAK_SYMBOL;
    void __llvm_profile_set_filename(const char* filename) TIA_WEAK_SYMBOL;
    const char* __llvm_profile_get_filename(void) TIA_WEAK_SYMBOL;
}

#define LLVM_PROFILE_RESET_COUNTERS __llvm_profile_reset_counters
#define LLVM_PROFILE_WRITE_FILE __llvm_profile_write_file
#define LLVM_PROFILE_SET_FILENAME __llvm_profile_set_filename
#define LLVM_PROFILE_GET_FILENAME __llvm_profile_get_filename

#else
// For MSVC: use runtime loading
typedef void (*LLVMProfileResetCountersFunc)(void);
typedef int (*LLVMProfileWriteFileFunc)(void);
typedef void (*LLVMProfileSetFilenameFunc)(const char*);
typedef const char* (*LLVMProfileGetFilenameFunc)(void);

static LLVMProfileResetCountersFunc g_resetCounters = nullptr;
static LLVMProfileWriteFileFunc g_writeFile = nullptr;
static LLVMProfileSetFilenameFunc g_setFilename = nullptr;
static LLVMProfileGetFilenameFunc g_getFilename = nullptr;
static bool g_functionsLoaded = false;

static void loadLLVMProfileFunctions() {
    if (g_functionsLoaded) return;
    g_functionsLoaded = true;

#ifdef TIA_PLATFORM_WINDOWS
    // Try to get functions from the current module (if linked with profile runtime)
    HMODULE hModule = GetModuleHandle(nullptr);
    if (hModule) {
        g_resetCounters = (LLVMProfileResetCountersFunc)
            GetProcAddress(hModule, "__llvm_profile_reset_counters");
        g_writeFile = (LLVMProfileWriteFileFunc)
            GetProcAddress(hModule, "__llvm_profile_write_file");
        g_setFilename = (LLVMProfileSetFilenameFunc)
            GetProcAddress(hModule, "__llvm_profile_set_filename");
        g_getFilename = (LLVMProfileGetFilenameFunc)
            GetProcAddress(hModule, "__llvm_profile_get_filename");
    }
#endif
}

#define LLVM_PROFILE_RESET_COUNTERS g_resetCounters
#define LLVM_PROFILE_WRITE_FILE g_writeFile
#define LLVM_PROFILE_SET_FILENAME g_setFilename
#define LLVM_PROFILE_GET_FILENAME g_getFilename

#endif // TIA_HAS_WEAK_SYMBOLS

namespace tia {

CoverageController& CoverageController::instance() {
    static CoverageController instance;
    return instance;
}

CoverageController::CoverageController() {
#if !TIA_HAS_WEAK_SYMBOLS
    loadLLVMProfileFunctions();
#endif

    // Check if LLVM Profile Runtime is available
    runtimeAvailable_ = (LLVM_PROFILE_RESET_COUNTERS != nullptr &&
                         LLVM_PROFILE_WRITE_FILE != nullptr &&
                         LLVM_PROFILE_SET_FILENAME != nullptr);

    if (runtimeAvailable_) {
        std::cout << "[TiaCC] LLVM Profile Runtime detected and available\n";
    } else {
        std::cerr << "[TiaCC] Warning: LLVM Profile Runtime not available.\n"
                  << "        Compile with -fprofile-instr-generate -fcoverage-mapping\n";
    }
}

CoverageController::~CoverageController() {
    if (recording_) {
        stopRecording();
    }
}

void CoverageController::reset() {
    std::lock_guard<std::mutex> lock(mutex_);

    if (runtimeAvailable_) {
        llvmProfileReset();
    }
}

bool CoverageController::startRecording(const std::string& testId) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (recording_) {
        std::cerr << "[TiaCC] Warning: Already recording test '"
                  << currentTestId_ << "'\n";
        return false;
    }

    if (!runtimeAvailable_) {
        std::cerr << "[TiaCC] Error: Cannot start recording - runtime not available\n";
        return false;
    }

    // Reset counters before starting new recording
    llvmProfileReset();

    currentTestId_ = testId;
    recording_ = true;

    std::cout << "[TiaCC] Started recording: " << testId << "\n";
    return true;
}

bool CoverageController::stopRecording() {
    std::lock_guard<std::mutex> lock(mutex_);

    if (!recording_) {
        return false;
    }

    std::cout << "[TiaCC] Stopped recording: " << currentTestId_ << "\n";
    recording_ = false;
    return true;
}

bool CoverageController::dumpToFile(const std::string& outputPath) {
    std::lock_guard<std::mutex> lock(mutex_);

    if (!runtimeAvailable_) {
        std::cerr << "[TiaCC] Error: Cannot dump - runtime not available\n";
        return false;
    }

    // Ensure output directory exists
    platform::ensureDirectoryExists(outputPath);

    // Set output filename and write
    llvmProfileSetFilename(outputPath);
    int result = llvmProfileWrite(outputPath);

    if (result != 0) {
        std::cerr << "[TiaCC] Error: Failed to write coverage data to '"
                  << outputPath << "' (error code: " << result << ")\n";
        return false;
    }

    std::cout << "[TiaCC] Coverage written to: " << outputPath << "\n";
    return true;
}

bool CoverageController::isRecording() const {
    return recording_;
}

std::string CoverageController::currentTestId() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return currentTestId_;
}

bool CoverageController::isRuntimeAvailable() const {
    return runtimeAvailable_;
}

void CoverageController::llvmProfileReset() {
    if (LLVM_PROFILE_RESET_COUNTERS) {
        LLVM_PROFILE_RESET_COUNTERS();
    }
}

int CoverageController::llvmProfileWrite(const std::string& path) {
    if (LLVM_PROFILE_WRITE_FILE) {
        return LLVM_PROFILE_WRITE_FILE();
    }
    return -1;
}

void CoverageController::llvmProfileSetFilename(const std::string& path) {
    if (LLVM_PROFILE_SET_FILENAME) {
        LLVM_PROFILE_SET_FILENAME(path.c_str());
    }
}

} // namespace tia
