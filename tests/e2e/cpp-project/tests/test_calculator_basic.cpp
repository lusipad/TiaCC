/**
 * 计算器基础功能测试
 * 测试 Calculator 类的基本四则运算
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
    std::cout << "=== Test Calculator Basic ===" << std::endl;
    Calculator calc;

    // 测试加法
    std::cout << "Testing add..." << std::endl;
    ASSERT_NEAR(calc.add(2, 3), 5.0, 0.001);
    ASSERT_NEAR(calc.add(-1, 1), 0.0, 0.001);
    ASSERT_NEAR(calc.add(0.1, 0.2), 0.3, 0.001);
    ASSERT_NEAR(calc.add(-5, -3), -8.0, 0.001);

    // 测试减法
    std::cout << "Testing subtract..." << std::endl;
    ASSERT_NEAR(calc.subtract(5, 3), 2.0, 0.001);
    ASSERT_NEAR(calc.subtract(3, 5), -2.0, 0.001);
    ASSERT_NEAR(calc.subtract(0, 0), 0.0, 0.001);

    // 测试乘法
    std::cout << "Testing multiply..." << std::endl;
    ASSERT_NEAR(calc.multiply(3, 4), 12.0, 0.001);
    ASSERT_NEAR(calc.multiply(-2, 3), -6.0, 0.001);
    ASSERT_NEAR(calc.multiply(-2, -3), 6.0, 0.001);
    ASSERT_NEAR(calc.multiply(0, 100), 0.0, 0.001);

    // 测试除法
    std::cout << "Testing divide..." << std::endl;
    ASSERT_NEAR(calc.divide(10, 2), 5.0, 0.001);
    ASSERT_NEAR(calc.divide(7, 2), 3.5, 0.001);
    ASSERT_NEAR(calc.divide(-6, 2), -3.0, 0.001);

    // 测试除以零
    std::cout << "Testing divide by zero..." << std::endl;
    ASSERT_THROW(calc.divide(1, 0), std::invalid_argument);

    std::cout << "=== All basic tests passed! ===" << std::endl;
    return 0;
}
