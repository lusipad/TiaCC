#ifndef STATISTICS_H
#define STATISTICS_H

#include <vector>
#include <string>

/**
 * 统计计算类
 * 提供基本的统计功能
 */
class Statistics {
public:
    // 基本统计
    double mean(const std::vector<double>& data);
    double median(const std::vector<double>& data);
    double variance(const std::vector<double>& data);
    double stddev(const std::vector<double>& data);

    // 范围
    double min(const std::vector<double>& data);
    double max(const std::vector<double>& data);
    double range(const std::vector<double>& data);

    // 汇总
    double sum(const std::vector<double>& data);
    size_t count(const std::vector<double>& data);

    // 格式化输出
    std::string formatSummary(const std::vector<double>& data);
};

#endif // STATISTICS_H
