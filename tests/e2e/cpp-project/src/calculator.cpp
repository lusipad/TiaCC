#include "calculator.h"
#include <cmath>
#include <stdexcept>

// 基础四则运算

double Calculator::add(double a, double b) {
    return a + b;
}

double Calculator::subtract(double a, double b) {
    return a - b;
}

double Calculator::multiply(double a, double b) {
    return a * b;
}

double Calculator::divide(double a, double b) {
    if (b == 0.0) {
        throw std::invalid_argument("Division by zero");
    }
    return a / b;
}

// 高级运算

double Calculator::power(double base, int exponent) {
    if (exponent == 0) {
        return 1.0;
    }

    double result = 1.0;
    int absExp = exponent > 0 ? exponent : -exponent;

    for (int i = 0; i < absExp; ++i) {
        result *= base;
    }

    if (exponent < 0) {
        return 1.0 / result;
    }

    return result;
}

double Calculator::sqrt(double x) {
    if (x < 0) {
        throw std::invalid_argument("Cannot compute square root of negative number");
    }
    return std::sqrt(x);
}

double Calculator::abs(double x) {
    if (x < 0) {
        return -x;
    }
    return x;
}

// 累加器功能

void Calculator::reset() {
    accumulator_ = 0.0;
}

void Calculator::accumulate(double value) {
    accumulator_ += value;
}

double Calculator::getAccumulator() const {
    return accumulator_;
}
