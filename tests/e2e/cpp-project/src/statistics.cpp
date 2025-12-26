#include "statistics.h"
#include "string_utils.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <sstream>
#include <iomanip>

double Statistics::sum(const std::vector<double>& data) {
    double total = 0.0;
    for (const auto& value : data) {
        total += value;
    }
    return total;
}

size_t Statistics::count(const std::vector<double>& data) {
    return data.size();
}

double Statistics::mean(const std::vector<double>& data) {
    if (data.empty()) {
        throw std::invalid_argument("Cannot compute mean of empty dataset");
    }
    return sum(data) / static_cast<double>(data.size());
}

double Statistics::median(const std::vector<double>& data) {
    if (data.empty()) {
        throw std::invalid_argument("Cannot compute median of empty dataset");
    }

    std::vector<double> sorted = data;
    std::sort(sorted.begin(), sorted.end());

    size_t n = sorted.size();
    if (n % 2 == 0) {
        return (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0;
    } else {
        return sorted[n / 2];
    }
}

double Statistics::variance(const std::vector<double>& data) {
    if (data.size() < 2) {
        throw std::invalid_argument("Need at least 2 data points for variance");
    }

    double m = mean(data);
    double sumSquares = 0.0;

    for (const auto& value : data) {
        double diff = value - m;
        sumSquares += diff * diff;
    }

    return sumSquares / static_cast<double>(data.size() - 1);
}

double Statistics::stddev(const std::vector<double>& data) {
    return std::sqrt(variance(data));
}

double Statistics::min(const std::vector<double>& data) {
    if (data.empty()) {
        throw std::invalid_argument("Cannot compute min of empty dataset");
    }

    double minVal = data[0];
    for (size_t i = 1; i < data.size(); ++i) {
        if (data[i] < minVal) {
            minVal = data[i];
        }
    }
    return minVal;
}

double Statistics::max(const std::vector<double>& data) {
    if (data.empty()) {
        throw std::invalid_argument("Cannot compute max of empty dataset");
    }

    double maxVal = data[0];
    for (size_t i = 1; i < data.size(); ++i) {
        if (data[i] > maxVal) {
            maxVal = data[i];
        }
    }
    return maxVal;
}

double Statistics::range(const std::vector<double>& data) {
    return max(data) - min(data);
}

std::string Statistics::formatSummary(const std::vector<double>& data) {
    if (data.empty()) {
        return "Empty dataset";
    }

    std::ostringstream oss;
    oss << std::fixed << std::setprecision(2);
    oss << "Statistics Summary:\n";
    oss << "  Count: " << count(data) << "\n";
    oss << "  Sum: " << sum(data) << "\n";
    oss << "  Mean: " << mean(data) << "\n";
    oss << "  Median: " << median(data) << "\n";
    oss << "  Min: " << min(data) << "\n";
    oss << "  Max: " << max(data) << "\n";
    oss << "  Range: " << range(data) << "\n";

    if (data.size() >= 2) {
        oss << "  Variance: " << variance(data) << "\n";
        oss << "  StdDev: " << stddev(data) << "\n";
    }

    // 使用 string_utils 格式化标题
    std::string title = StringUtils::toUpperCase("summary complete");
    oss << "  [" << title << "]";

    return oss.str();
}
