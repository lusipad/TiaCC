#include "string_utils.h"
#include <algorithm>
#include <cctype>
#include <sstream>

std::string StringUtils::toUpperCase(const std::string& str) {
    std::string result = str;
    std::transform(result.begin(), result.end(), result.begin(),
                   [](unsigned char c) { return std::toupper(c); });
    return result;
}

std::string StringUtils::toLowerCase(const std::string& str) {
    std::string result = str;
    std::transform(result.begin(), result.end(), result.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return result;
}

std::string StringUtils::trim(const std::string& str) {
    return trimRight(trimLeft(str));
}

std::string StringUtils::trimLeft(const std::string& str) {
    size_t start = 0;
    while (start < str.size() && std::isspace(static_cast<unsigned char>(str[start]))) {
        ++start;
    }
    return str.substr(start);
}

std::string StringUtils::trimRight(const std::string& str) {
    size_t end = str.size();
    while (end > 0 && std::isspace(static_cast<unsigned char>(str[end - 1]))) {
        --end;
    }
    return str.substr(0, end);
}

std::vector<std::string> StringUtils::split(const std::string& str, char delimiter) {
    std::vector<std::string> result;
    std::istringstream stream(str);
    std::string token;

    while (std::getline(stream, token, delimiter)) {
        result.push_back(token);
    }

    return result;
}

std::string StringUtils::join(const std::vector<std::string>& parts, const std::string& delimiter) {
    if (parts.empty()) {
        return "";
    }

    std::ostringstream result;
    result << parts[0];

    for (size_t i = 1; i < parts.size(); ++i) {
        result << delimiter << parts[i];
    }

    return result.str();
}

bool StringUtils::startsWith(const std::string& str, const std::string& prefix) {
    if (prefix.size() > str.size()) {
        return false;
    }
    return str.compare(0, prefix.size(), prefix) == 0;
}

bool StringUtils::endsWith(const std::string& str, const std::string& suffix) {
    if (suffix.size() > str.size()) {
        return false;
    }
    return str.compare(str.size() - suffix.size(), suffix.size(), suffix) == 0;
}

std::string StringUtils::replace(const std::string& str, const std::string& from, const std::string& to) {
    if (from.empty()) {
        return str;
    }

    std::string result = str;
    size_t pos = 0;

    while ((pos = result.find(from, pos)) != std::string::npos) {
        result.replace(pos, from.size(), to);
        pos += to.size();
    }

    return result;
}

std::string StringUtils::padLeft(const std::string& str, size_t width, char padChar) {
    if (str.size() >= width) {
        return str;
    }
    return std::string(width - str.size(), padChar) + str;
}

std::string StringUtils::padRight(const std::string& str, size_t width, char padChar) {
    if (str.size() >= width) {
        return str;
    }
    return str + std::string(width - str.size(), padChar);
}
