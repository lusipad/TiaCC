// Platform-specific code for macOS
#include "tia/platform.h"

#ifdef TIA_PLATFORM_MACOS

#include <mach-o/dyld.h>
#include <sys/stat.h>
#include <errno.h>
#include <climits>
#include <cstring>

namespace tia {
namespace platform {

std::string getExecutablePath() {
    char buffer[PATH_MAX];
    uint32_t size = sizeof(buffer);
    if (_NSGetExecutablePath(buffer, &size) == 0) {
        // Resolve symlinks
        char resolved[PATH_MAX];
        if (realpath(buffer, resolved) != nullptr) {
            return std::string(resolved);
        }
        return std::string(buffer);
    }
    return "";
}

std::string normalizePath(const std::string& path) {
    // macOS paths already use forward slashes
    return path;
}

bool ensureDirectoryExists(const std::string& path) {
    size_t lastSlash = path.find_last_of('/');
    if (lastSlash == std::string::npos || lastSlash == 0) {
        return true;
    }

    std::string dir = path.substr(0, lastSlash);

    // Create directories recursively
    std::string current;
    for (size_t i = 0; i < dir.size(); ++i) {
        current += dir[i];
        if (dir[i] == '/' || i == dir.size() - 1) {
            if (!current.empty() && current != "/") {
                int result = mkdir(current.c_str(), 0755);
                if (result != 0 && errno != EEXIST) {
                    return false;
                }
            }
        }
    }

    return true;
}

} // namespace platform
} // namespace tia

#endif // TIA_PLATFORM_MACOS
