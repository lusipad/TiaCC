#ifndef STRING_UTILS_H
#define STRING_UTILS_H

#include <string>
#include <vector>

/**
 * 字符串工具类
 * 提供常用的字符串操作功能
 */
class StringUtils {
public:
    // 大小写转换
    static std::string toUpperCase(const std::string& str);
    static std::string toLowerCase(const std::string& str);

    // 去除空白
    static std::string trim(const std::string& str);
    static std::string trimLeft(const std::string& str);
    static std::string trimRight(const std::string& str);

    // 分割和连接
    static std::vector<std::string> split(const std::string& str, char delimiter);
    static std::string join(const std::vector<std::string>& parts, const std::string& delimiter);

    // 查找和替换
    static bool startsWith(const std::string& str, const std::string& prefix);
    static bool endsWith(const std::string& str, const std::string& suffix);
    static std::string replace(const std::string& str, const std::string& from, const std::string& to);

    // 格式化
    static std::string padLeft(const std::string& str, size_t width, char padChar = ' ');
    static std::string padRight(const std::string& str, size_t width, char padChar = ' ');
};

#endif // STRING_UTILS_H
