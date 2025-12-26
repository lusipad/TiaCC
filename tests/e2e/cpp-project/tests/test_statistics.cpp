/**
 * 统计模块测试
 * 测试 Statistics 类的统计计算功能
 */

#include "../src/statistics.h"
#include <iostream>
#include <cmath>
#include <vector>

#define ASSERT_NEAR(a, b, eps) \
    if (std::abs((a) - (b)) > (eps)) { \
        std::cerr << "FAIL: " << #a << " = " << (a) << ", expected " << (b) << std::endl; \
        return 1; \
    }

#define ASSERT_EQ(a, b) \
    if ((a) != (b)) { \
        std::cerr << "FAIL: " << #a << " = " << (a) << ", expected " << (b) << std::endl; \
        return 1; \
    }

#define ASSERT_THROW(expr, ExceptionType) \
    try { \
        expr; \
        std::cerr << "FAIL: Expected exception " << #ExceptionType << std::endl; \
        return 1; \
    } catch (const ExceptionType&) { \
        /* OK */ \
    }

int main() {
    std::cout << "=== Test Statistics ===" << std::endl;
    Statistics stats;

    std::vector<double> data1 = {1, 2, 3, 4, 5};
    std::vector<double> data2 = {2, 4, 4, 4, 5, 5, 7, 9};
    std::vector<double> data3 = {1, 2, 3, 4, 5, 6};
    std::vector<double> empty = {};

    // 测试 sum 和 count
    std::cout << "Testing sum and count..." << std::endl;
    ASSERT_NEAR(stats.sum(data1), 15.0, 0.001);
    ASSERT_EQ(stats.count(data1), 5);
    ASSERT_NEAR(stats.sum(data2), 40.0, 0.001);
    ASSERT_EQ(stats.count(data2), 8);

    // 测试 mean
    std::cout << "Testing mean..." << std::endl;
    ASSERT_NEAR(stats.mean(data1), 3.0, 0.001);
    ASSERT_NEAR(stats.mean(data2), 5.0, 0.001);
    ASSERT_THROW(stats.mean(empty), std::invalid_argument);

    // 测试 median
    std::cout << "Testing median..." << std::endl;
    ASSERT_NEAR(stats.median(data1), 3.0, 0.001);      // 奇数个元素
    ASSERT_NEAR(stats.median(data3), 3.5, 0.001);      // 偶数个元素
    ASSERT_THROW(stats.median(empty), std::invalid_argument);

    // 测试 min/max/range
    std::cout << "Testing min/max/range..." << std::endl;
    ASSERT_NEAR(stats.min(data1), 1.0, 0.001);
    ASSERT_NEAR(stats.max(data1), 5.0, 0.001);
    ASSERT_NEAR(stats.range(data1), 4.0, 0.001);

    ASSERT_NEAR(stats.min(data2), 2.0, 0.001);
    ASSERT_NEAR(stats.max(data2), 9.0, 0.001);
    ASSERT_NEAR(stats.range(data2), 7.0, 0.001);

    // 测试 variance 和 stddev
    std::cout << "Testing variance and stddev..." << std::endl;
    ASSERT_NEAR(stats.variance(data1), 2.5, 0.001);
    ASSERT_NEAR(stats.stddev(data1), 1.5811, 0.001);

    // 测试 formatSummary
    std::cout << "Testing formatSummary..." << std::endl;
    std::string summary = stats.formatSummary(data1);
    std::cout << summary << std::endl;

    // 验证 summary 包含关键信息
    if (summary.find("Count: 5") == std::string::npos) {
        std::cerr << "FAIL: Summary should contain count" << std::endl;
        return 1;
    }
    if (summary.find("SUMMARY COMPLETE") == std::string::npos) {
        std::cerr << "FAIL: Summary should contain uppercase title" << std::endl;
        return 1;
    }

    // 测试空数据集的 formatSummary
    std::string emptySummary = stats.formatSummary(empty);
    if (emptySummary.find("Empty") == std::string::npos) {
        std::cerr << "FAIL: Empty summary should indicate empty dataset" << std::endl;
        return 1;
    }

    std::cout << "=== All statistics tests passed! ===" << std::endl;
    return 0;
}
