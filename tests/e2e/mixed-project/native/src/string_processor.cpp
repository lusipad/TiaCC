#include "string_processor.h"
#include <cstring>
#include <cctype>
#include <cstdlib>

// 错误码
#define ERROR_NONE 0
#define ERROR_INVALID_FORMAT 1
#define ERROR_NULL_INPUT 2

// 字符串操作

NATIVE_API int StringProcessor_GetLength(const char* str) {
    if (!str) {
        return 0;
    }
    return static_cast<int>(std::strlen(str));
}

NATIVE_API void StringProcessor_ToUpperCase(const char* input, char* output, int maxLen) {
    if (!input || !output || maxLen <= 0) {
        return;
    }

    int i = 0;
    while (input[i] && i < maxLen - 1) {
        output[i] = static_cast<char>(std::toupper(static_cast<unsigned char>(input[i])));
        ++i;
    }
    output[i] = '\0';
}

NATIVE_API void StringProcessor_ToLowerCase(const char* input, char* output, int maxLen) {
    if (!input || !output || maxLen <= 0) {
        return;
    }

    int i = 0;
    while (input[i] && i < maxLen - 1) {
        output[i] = static_cast<char>(std::tolower(static_cast<unsigned char>(input[i])));
        ++i;
    }
    output[i] = '\0';
}

// 字符串搜索

NATIVE_API int StringProcessor_Contains(const char* haystack, const char* needle) {
    if (!haystack || !needle) {
        return 0;
    }
    return std::strstr(haystack, needle) != nullptr ? 1 : 0;
}

NATIVE_API int StringProcessor_IndexOf(const char* haystack, const char* needle) {
    if (!haystack || !needle) {
        return -1;
    }

    const char* found = std::strstr(haystack, needle);
    if (!found) {
        return -1;
    }
    return static_cast<int>(found - haystack);
}

NATIVE_API int StringProcessor_StartsWith(const char* str, const char* prefix) {
    if (!str || !prefix) {
        return 0;
    }

    size_t strLen = std::strlen(str);
    size_t prefixLen = std::strlen(prefix);

    if (prefixLen > strLen) {
        return 0;
    }

    return std::strncmp(str, prefix, prefixLen) == 0 ? 1 : 0;
}

NATIVE_API int StringProcessor_EndsWith(const char* str, const char* suffix) {
    if (!str || !suffix) {
        return 0;
    }

    size_t strLen = std::strlen(str);
    size_t suffixLen = std::strlen(suffix);

    if (suffixLen > strLen) {
        return 0;
    }

    return std::strcmp(str + strLen - suffixLen, suffix) == 0 ? 1 : 0;
}

// 字符串操作

NATIVE_API void StringProcessor_Concat(const char* a, const char* b, char* output, int maxLen) {
    if (!a || !b || !output || maxLen <= 0) {
        return;
    }

    int i = 0;

    // 复制第一个字符串
    while (a[i] && i < maxLen - 1) {
        output[i] = a[i];
        ++i;
    }

    // 复制第二个字符串
    int j = 0;
    while (b[j] && i < maxLen - 1) {
        output[i] = b[j];
        ++i;
        ++j;
    }

    output[i] = '\0';
}

NATIVE_API void StringProcessor_Trim(const char* input, char* output, int maxLen) {
    if (!input || !output || maxLen <= 0) {
        return;
    }

    // 找到开始位置（跳过前导空白）
    const char* start = input;
    while (*start && std::isspace(static_cast<unsigned char>(*start))) {
        ++start;
    }

    if (*start == '\0') {
        output[0] = '\0';
        return;
    }

    // 找到结束位置（跳过尾随空白）
    const char* end = input + std::strlen(input) - 1;
    while (end > start && std::isspace(static_cast<unsigned char>(*end))) {
        --end;
    }

    // 复制结果
    int len = static_cast<int>(end - start + 1);
    if (len >= maxLen) {
        len = maxLen - 1;
    }

    std::memcpy(output, start, len);
    output[len] = '\0';
}

NATIVE_API void StringProcessor_Reverse(const char* input, char* output, int maxLen) {
    if (!input || !output || maxLen <= 0) {
        return;
    }

    int len = static_cast<int>(std::strlen(input));
    if (len >= maxLen) {
        len = maxLen - 1;
    }

    for (int i = 0; i < len; ++i) {
        output[i] = input[len - 1 - i];
    }
    output[len] = '\0';
}

// 字符串转换

NATIVE_API int StringProcessor_ToInt(const char* str, int* errorCode) {
    if (!str) {
        if (errorCode) *errorCode = ERROR_NULL_INPUT;
        return 0;
    }

    // Check for empty string
    if (*str == '\0') {
        if (errorCode) *errorCode = ERROR_INVALID_FORMAT;
        return 0;
    }

    char* endPtr;
    long result = std::strtol(str, &endPtr, 10);

    // Check if any characters were consumed and all were valid
    if (endPtr == str || *endPtr != '\0') {
        if (errorCode) *errorCode = ERROR_INVALID_FORMAT;
        return 0;
    }

    if (errorCode) *errorCode = ERROR_NONE;
    return static_cast<int>(result);
}

NATIVE_API double StringProcessor_ToDouble(const char* str, int* errorCode) {
    if (!str) {
        if (errorCode) *errorCode = ERROR_NULL_INPUT;
        return 0.0;
    }

    // Check for empty string
    if (*str == '\0') {
        if (errorCode) *errorCode = ERROR_INVALID_FORMAT;
        return 0.0;
    }

    char* endPtr;
    double result = std::strtod(str, &endPtr);

    // Check if any characters were consumed and all were valid
    if (endPtr == str || *endPtr != '\0') {
        if (errorCode) *errorCode = ERROR_INVALID_FORMAT;
        return 0.0;
    }

    if (errorCode) *errorCode = ERROR_NONE;
    return result;
}
