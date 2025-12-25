#include "tia/platform.h"
#include <algorithm>

namespace tia {
namespace platform {

std::string joinPath(const std::string& base, const std::string& component) {
    if (base.empty()) {
        return component;
    }
    if (component.empty()) {
        return base;
    }

    std::string result = base;

    // Remove trailing separator from base
    while (!result.empty() && (result.back() == '/' || result.back() == '\\')) {
        result.pop_back();
    }

    // Remove leading separator from component
    size_t start = 0;
    while (start < component.size() && (component[start] == '/' || component[start] == '\\')) {
        ++start;
    }

    result += '/';
    result += component.substr(start);

    return result;
}

} // namespace platform
} // namespace tia
