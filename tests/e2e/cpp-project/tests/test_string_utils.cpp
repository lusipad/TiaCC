/**
 * 字符串工具测试
 * 测试 StringUtils 类的字符串操作功能
 */

#include "../src/string_utils.h"
#include <iostream>
#include <vector>
#include <string>

#define ASSERT_EQ(a, b) \
    if ((a) != (b)) { \
        std::cerr << "FAIL: " << #a << " = \"" << (a) << "\", expected \"" << (b) << "\"" << std::endl; \
        return 1; \
    }

#define ASSERT_TRUE(cond) \
    if (!(cond)) { \
        std::cerr << "FAIL: " << #cond << " is false" << std::endl; \
        return 1; \
    }

#define ASSERT_FALSE(cond) \
    if (cond) { \
        std::cerr << "FAIL: " << #cond << " is true" << std::endl; \
        return 1; \
    }

int main() {
    std::cout << "=== Test String Utils ===" << std::endl;

    // 测试大小写转换
    std::cout << "Testing case conversion..." << std::endl;
    ASSERT_EQ(StringUtils::toUpperCase("hello"), "HELLO");
    ASSERT_EQ(StringUtils::toUpperCase("Hello World"), "HELLO WORLD");
    ASSERT_EQ(StringUtils::toUpperCase("123abc"), "123ABC");
    ASSERT_EQ(StringUtils::toLowerCase("HELLO"), "hello");
    ASSERT_EQ(StringUtils::toLowerCase("Hello World"), "hello world");

    // 测试 trim
    std::cout << "Testing trim..." << std::endl;
    ASSERT_EQ(StringUtils::trim("  hello  "), "hello");
    ASSERT_EQ(StringUtils::trim("hello"), "hello");
    ASSERT_EQ(StringUtils::trim("   "), "");
    ASSERT_EQ(StringUtils::trimLeft("  hello"), "hello");
    ASSERT_EQ(StringUtils::trimRight("hello  "), "hello");

    // 测试 split
    std::cout << "Testing split..." << std::endl;
    std::vector<std::string> parts = StringUtils::split("a,b,c", ',');
    ASSERT_EQ(parts.size(), 3);
    ASSERT_EQ(parts[0], "a");
    ASSERT_EQ(parts[1], "b");
    ASSERT_EQ(parts[2], "c");

    parts = StringUtils::split("hello world test", ' ');
    ASSERT_EQ(parts.size(), 3);
    ASSERT_EQ(parts[0], "hello");
    ASSERT_EQ(parts[1], "world");
    ASSERT_EQ(parts[2], "test");

    // 测试 join
    std::cout << "Testing join..." << std::endl;
    ASSERT_EQ(StringUtils::join({"a", "b", "c"}, ","), "a,b,c");
    ASSERT_EQ(StringUtils::join({"hello", "world"}, " "), "hello world");
    ASSERT_EQ(StringUtils::join({}, ","), "");
    ASSERT_EQ(StringUtils::join({"single"}, ","), "single");

    // 测试 startsWith/endsWith
    std::cout << "Testing startsWith/endsWith..." << std::endl;
    ASSERT_TRUE(StringUtils::startsWith("hello world", "hello"));
    ASSERT_FALSE(StringUtils::startsWith("hello world", "world"));
    ASSERT_TRUE(StringUtils::endsWith("hello world", "world"));
    ASSERT_FALSE(StringUtils::endsWith("hello world", "hello"));
    ASSERT_TRUE(StringUtils::startsWith("test", "test"));
    ASSERT_TRUE(StringUtils::endsWith("test", "test"));

    // 测试 replace
    std::cout << "Testing replace..." << std::endl;
    ASSERT_EQ(StringUtils::replace("hello world", "world", "there"), "hello there");
    ASSERT_EQ(StringUtils::replace("aaa", "a", "b"), "bbb");
    ASSERT_EQ(StringUtils::replace("hello", "x", "y"), "hello");
    ASSERT_EQ(StringUtils::replace("hello", "", "x"), "hello");

    // 测试 padLeft/padRight
    std::cout << "Testing padding..." << std::endl;
    ASSERT_EQ(StringUtils::padLeft("42", 5, '0'), "00042");
    ASSERT_EQ(StringUtils::padLeft("hello", 3), "hello");
    ASSERT_EQ(StringUtils::padRight("42", 5, '0'), "42000");
    ASSERT_EQ(StringUtils::padRight("hello", 3), "hello");

    std::cout << "=== All string utils tests passed! ===" << std::endl;
    return 0;
}
