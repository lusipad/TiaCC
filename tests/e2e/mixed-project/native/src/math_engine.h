#ifndef MATH_ENGINE_H
#define MATH_ENGINE_H

#ifdef _WIN32
    #ifdef NATIVE_LIB_EXPORTS
        #define NATIVE_API __declspec(dllexport)
    #else
        #define NATIVE_API __declspec(dllimport)
    #endif
#else
    #define NATIVE_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

// 基础数学运算
NATIVE_API double MathEngine_Add(double a, double b);
NATIVE_API double MathEngine_Subtract(double a, double b);
NATIVE_API double MathEngine_Multiply(double a, double b);
NATIVE_API double MathEngine_Divide(double a, double b, int* errorCode);

// 高级数学运算
NATIVE_API double MathEngine_Power(double base, int exponent);
NATIVE_API double MathEngine_Sqrt(double value, int* errorCode);
NATIVE_API double MathEngine_Abs(double value);

// 向量运算
NATIVE_API double MathEngine_DotProduct(const double* a, const double* b, int length);
NATIVE_API void MathEngine_Normalize(double* vec, int length);

// 矩阵运算
NATIVE_API void MathEngine_MatrixMultiply(
    const double* a, int aRows, int aCols,
    const double* b, int bRows, int bCols,
    double* result
);

#ifdef __cplusplus
}
#endif

#endif // MATH_ENGINE_H
