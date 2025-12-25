#pragma once

#include <string>

// Platform detection macros
#if defined(_WIN32) || defined(_WIN64)
    #define TIA_PLATFORM_WINDOWS 1
    #define TIA_PLATFORM_NAME "windows"
#elif defined(__APPLE__)
    #define TIA_PLATFORM_MACOS 1
    #define TIA_PLATFORM_NAME "macos"
#elif defined(__linux__)
    #define TIA_PLATFORM_LINUX 1
    #define TIA_PLATFORM_NAME "linux"
#else
    #define TIA_PLATFORM_UNKNOWN 1
    #define TIA_PLATFORM_NAME "unknown"
#endif

// Compiler detection
#if defined(__clang__)
    #define TIA_COMPILER_CLANG 1
    #define TIA_COMPILER_NAME "clang"
#elif defined(__GNUC__)
    #define TIA_COMPILER_GCC 1
    #define TIA_COMPILER_NAME "gcc"
#elif defined(_MSC_VER)
    #define TIA_COMPILER_MSVC 1
    #define TIA_COMPILER_NAME "msvc"
#endif

// Weak symbol support (for optional LLVM runtime linking)
#if defined(TIA_COMPILER_CLANG) || defined(TIA_COMPILER_GCC)
    #define TIA_WEAK_SYMBOL __attribute__((weak))
    #define TIA_HAS_WEAK_SYMBOLS 1
#else
    // MSVC doesn't support weak symbols, use runtime loading instead
    #define TIA_WEAK_SYMBOL
    #define TIA_HAS_WEAK_SYMBOLS 0
#endif

// Export/Import macros for shared libraries
#if defined(TIA_PLATFORM_WINDOWS)
    #ifdef TIA_BUILDING_DLL
        #define TIA_API __declspec(dllexport)
    #else
        #define TIA_API __declspec(dllimport)
    #endif
#else
    #define TIA_API __attribute__((visibility("default")))
#endif

// For static library builds
#ifdef TIA_STATIC
    #undef TIA_API
    #define TIA_API
#endif

namespace tia {
namespace platform {

/**
 * @brief Get the path to the current executable
 */
std::string getExecutablePath();

/**
 * @brief Normalize path separators to forward slashes
 */
std::string normalizePath(const std::string& path);

/**
 * @brief Ensure a directory exists, creating it if necessary
 */
bool ensureDirectoryExists(const std::string& path);

/**
 * @brief Get the directory separator for the current platform
 */
inline char getPathSeparator() {
#ifdef TIA_PLATFORM_WINDOWS
    return '\\';
#else
    return '/';
#endif
}

/**
 * @brief Join path components
 */
std::string joinPath(const std::string& base, const std::string& component);

} // namespace platform
} // namespace tia
