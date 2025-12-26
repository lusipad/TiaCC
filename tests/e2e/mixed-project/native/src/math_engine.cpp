#include "math_engine.h"
#include <cmath>
#include <cstring>

// 错误码定义
#define ERROR_NONE 0
#define ERROR_DIVISION_BY_ZERO 1
#define ERROR_INVALID_INPUT 2
#define ERROR_NEGATIVE_SQRT 3

// 基础数学运算

NATIVE_API double MathEngine_Add(double a, double b) {
    return a + b;
}

NATIVE_API double MathEngine_Subtract(double a, double b) {
    return a - b;
}

NATIVE_API double MathEngine_Multiply(double a, double b) {
    return a * b;
}

NATIVE_API double MathEngine_Divide(double a, double b, int* errorCode) {
    if (b == 0.0) {
        if (errorCode) *errorCode = ERROR_DIVISION_BY_ZERO;
        return 0.0;
    }
    if (errorCode) *errorCode = ERROR_NONE;
    return a / b;
}

// 高级数学运算

NATIVE_API double MathEngine_Power(double base, int exponent) {
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

NATIVE_API double MathEngine_Sqrt(double value, int* errorCode) {
    if (value < 0.0) {
        if (errorCode) *errorCode = ERROR_NEGATIVE_SQRT;
        return 0.0;
    }
    if (errorCode) *errorCode = ERROR_NONE;
    return std::sqrt(value);
}

NATIVE_API double MathEngine_Abs(double value) {
    return value < 0 ? -value : value;
}

// 向量运算

NATIVE_API double MathEngine_DotProduct(const double* a, const double* b, int length) {
    if (!a || !b || length <= 0) {
        return 0.0;
    }

    double result = 0.0;
    for (int i = 0; i < length; ++i) {
        result += a[i] * b[i];
    }
    return result;
}

NATIVE_API void MathEngine_Normalize(double* vec, int length) {
    if (!vec || length <= 0) {
        return;
    }

    // 计算长度
    double len = 0.0;
    for (int i = 0; i < length; ++i) {
        len += vec[i] * vec[i];
    }
    len = std::sqrt(len);

    // 避免除以零
    if (len < 1e-10) {
        return;
    }

    // 归一化
    for (int i = 0; i < length; ++i) {
        vec[i] /= len;
    }
}

// 矩阵运算

NATIVE_API void MathEngine_MatrixMultiply(
    const double* a, int aRows, int aCols,
    const double* b, int bRows, int bCols,
    double* result)
{
    if (!a || !b || !result) {
        return;
    }

    if (aCols != bRows) {
        return; // 矩阵维度不匹配
    }

    // 初始化结果矩阵
    std::memset(result, 0, aRows * bCols * sizeof(double));

    // 矩阵乘法
    for (int i = 0; i < aRows; ++i) {
        for (int j = 0; j < bCols; ++j) {
            for (int k = 0; k < aCols; ++k) {
                result[i * bCols + j] += a[i * aCols + k] * b[k * bCols + j];
            }
        }
    }
}
