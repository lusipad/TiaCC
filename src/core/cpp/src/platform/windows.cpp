// Platform-specific code for Windows
#include "tia/platform.h"

#ifdef TIA_PLATFORM_WINDOWS

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <direct.h>
#include <shlwapi.h>

#pragma comment(lib, "shlwapi.lib")

namespace tia {
namespace platform {

std::string getExecutablePath() {
    char buffer[MAX_PATH];
    DWORD len = GetModuleFileNameA(nullptr, buffer, MAX_PATH);
    if (len > 0 && len < MAX_PATH) {
        return std::string(buffer, len);
    }
    return "";
}

std::string normalizePath(const std::string& path) {
    std::string normalized = path;
    // Convert backslashes to forward slashes for consistency
    for (char& c : normalized) {
        if (c == '\\') {
            c = '/';
        }
    }
    return normalized;
}

bool ensureDirectoryExists(const std::string& path) {
    // Extract directory from path
    std::string normalized = normalizePath(path);
    size_t lastSlash = normalized.find_last_of('/');
    if (lastSlash == std::string::npos || lastSlash == 0) {
        return true; // No directory component or root
    }

    std::string dir = normalized.substr(0, lastSlash);

    // Convert back to Windows path for API
    std::string winDir = dir;
    for (char& c : winDir) {
        if (c == '/') {
            c = '\\';
        }
    }

    // Create directory recursively
    // SHCreateDirectoryEx handles creating parent directories
    int result = SHCreateDirectoryExA(nullptr, winDir.c_str(), nullptr);
    return result == ERROR_SUCCESS ||
           result == ERROR_FILE_EXISTS ||
           result == ERROR_ALREADY_EXISTS;
}

} // namespace platform
} // namespace tia

#endif // TIA_PLATFORM_WINDOWS
