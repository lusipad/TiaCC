#ifndef CALCULATOR_H
#define CALCULATOR_H

/**
 * 简单计算器类
 * 用于验证 TiaCC 的覆盖率收集和映射功能
 */
class Calculator {
public:
    // 基础四则运算
    double add(double a, double b);
    double subtract(double a, double b);
    double multiply(double a, double b);
    double divide(double a, double b);

    // 高级运算
    double power(double base, int exponent);
    double sqrt(double x);
    double abs(double x);

    // 累加器功能
    void reset();
    void accumulate(double value);
    double getAccumulator() const;

private:
    double accumulator_ = 0.0;
};

#endif // CALCULATOR_H
