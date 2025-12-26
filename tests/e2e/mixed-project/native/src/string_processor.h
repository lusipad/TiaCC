#ifndef STRING_PROCESSOR_H
#define STRING_PROCESSOR_H

#ifdef _WIN32
    #ifdef NATIVE_LIB_EXPORTS
        #define NATIVE_API __declspec(dllexport)
    #else
        #define NATIVE_API __declspec(dllimport)
    #endif
#else
    #define NATIVE_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

// 字符串操作
NATIVE_API int StringProcessor_GetLength(const char* str);
NATIVE_API void StringProcessor_ToUpperCase(const char* input, char* output, int maxLen);
NATIVE_API void StringProcessor_ToLowerCase(const char* input, char* output, int maxLen);

// 字符串搜索
NATIVE_API int StringProcessor_Contains(const char* haystack, const char* needle);
NATIVE_API int StringProcessor_IndexOf(const char* haystack, const char* needle);
NATIVE_API int StringProcessor_StartsWith(const char* str, const char* prefix);
NATIVE_API int StringProcessor_EndsWith(const char* str, const char* suffix);

// 字符串操作
NATIVE_API void StringProcessor_Concat(const char* a, const char* b, char* output, int maxLen);
NATIVE_API void StringProcessor_Trim(const char* input, char* output, int maxLen);
NATIVE_API void StringProcessor_Reverse(const char* input, char* output, int maxLen);

// 字符串转换
NATIVE_API int StringProcessor_ToInt(const char* str, int* errorCode);
NATIVE_API double StringProcessor_ToDouble(const char* str, int* errorCode);

#ifdef __cplusplus
}
#endif

#endif // STRING_PROCESSOR_H
