cmake_minimum_required(VERSION 3.20)
project(native_lib VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 覆盖率选项
option(ENABLE_COVERAGE "Enable code coverage instrumentation" ON)

if(ENABLE_COVERAGE)
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
        message(STATUS "Enabling LLVM coverage instrumentation")
        set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fprofile-instr-generate -fcoverage-mapping")
        set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -fprofile-instr-generate")
    endif()
endif()

# 创建动态库
add_library(native_lib SHARED
    src/math_engine.cpp
    src/string_processor.cpp
)

# 导出宏
target_compile_definitions(native_lib PRIVATE NATIVE_LIB_EXPORTS)

# 包含目录
target_include_directories(native_lib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)

# Windows 特定设置
if(WIN32)
    # 设置输出目录
    set_target_properties(native_lib PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}
        LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}
        ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}
    )
endif()

# 输出信息
message(STATUS "Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "C++ Compiler: ${CMAKE_CXX_COMPILER}")
message(STATUS "Coverage enabled: ${ENABLE_COVERAGE}")
