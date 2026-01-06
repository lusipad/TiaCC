// Platform-specific code for Linux
#include "tia/platform.h"

#ifdef TIA_PLATFORM_LINUX

#include <unistd.h>
#include <limits.h>
#include <sys/stat.h>
#include <errno.h>
#include <cstring>

namespace tia {
namespace platform {

std::string getExecutablePath() {
    char buffer[PATH_MAX];
    ssize_t len = readlink("/proc/self/exe", buffer, sizeof(buffer) - 1);
    if (len != -1) {
        buffer[len] = '\0';
        return std::string(buffer);
    }
    return "";
}

std::string normalizePath(const std::string& path) {
    // Linux paths already use forward slashes
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

#endif // TIA_PLATFORM_LINUX
