/**
 * 计算器高级功能测试
 * 测试 Calculator 类的高级运算和累加器功能
 */

#include "../src/calculator.h"
#include <iostream>
#include <cmath>
#include <cassert>

#define ASSERT_NEAR(a, b, eps) \
    if (std::abs((a) - (b)) > (eps)) { \
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
    std::cout << "=== Test Calculator Advanced ===" << std::endl;
    Calculator calc;

    // 测试幂运算
    std::cout << "Testing power..." << std::endl;
    ASSERT_NEAR(calc.power(2, 3), 8.0, 0.001);
    ASSERT_NEAR(calc.power(2, 0), 1.0, 0.001);
    ASSERT_NEAR(calc.power(2, -1), 0.5, 0.001);
    ASSERT_NEAR(calc.power(3, 4), 81.0, 0.001);
    ASSERT_NEAR(calc.power(10, 2), 100.0, 0.001);

    // 测试平方根
    std::cout << "Testing sqrt..." << std::endl;
    ASSERT_NEAR(calc.sqrt(4), 2.0, 0.001);
    ASSERT_NEAR(calc.sqrt(9), 3.0, 0.001);
    ASSERT_NEAR(calc.sqrt(2), 1.41421, 0.001);
    ASSERT_NEAR(calc.sqrt(0), 0.0, 0.001);

    // 测试负数平方根抛出异常
    std::cout << "Testing sqrt of negative..." << std::endl;
    ASSERT_THROW(calc.sqrt(-1), std::invalid_argument);

    // 测试绝对值
    std::cout << "Testing abs..." << std::endl;
    ASSERT_NEAR(calc.abs(5), 5.0, 0.001);
    ASSERT_NEAR(calc.abs(-5), 5.0, 0.001);
    ASSERT_NEAR(calc.abs(0), 0.0, 0.001);

    // 测试累加器
    std::cout << "Testing accumulator..." << std::endl;
    calc.reset();
    ASSERT_NEAR(calc.getAccumulator(), 0.0, 0.001);

    calc.accumulate(10);
    ASSERT_NEAR(calc.getAccumulator(), 10.0, 0.001);

    calc.accumulate(5);
    ASSERT_NEAR(calc.getAccumulator(), 15.0, 0.001);

    calc.accumulate(-3);
    ASSERT_NEAR(calc.getAccumulator(), 12.0, 0.001);

    calc.reset();
    ASSERT_NEAR(calc.getAccumulator(), 0.0, 0.001);

    std::cout << "=== All advanced tests passed! ===" << std::endl;
    return 0;
}
