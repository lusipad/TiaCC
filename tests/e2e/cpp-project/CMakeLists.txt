cmake_minimum_required(VERSION 3.20)
project(TiaCC_E2E_CPP VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# 覆盖率编译选项 (需要使用 Clang)
option(ENABLE_COVERAGE "Enable code coverage instrumentation" ON)

if(ENABLE_COVERAGE)
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
        message(STATUS "Enabling LLVM coverage instrumentation")
        set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fprofile-instr-generate -fcoverage-mapping")
        set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -fprofile-instr-generate")
    else()
        message(WARNING "Coverage requires Clang compiler. Current: ${CMAKE_CXX_COMPILER_ID}")
    endif()
endif()

# 源文件库
add_library(tiacc_e2e_lib STATIC
    src/calculator.cpp
    src/statistics.cpp
    src/string_utils.cpp
)

target_include_directories(tiacc_e2e_lib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)

# 测试可执行文件
add_executable(test_calculator_basic tests/test_calculator_basic.cpp)
target_link_libraries(test_calculator_basic PRIVATE tiacc_e2e_lib)

add_executable(test_calculator_advanced tests/test_calculator_advanced.cpp)
target_link_libraries(test_calculator_advanced PRIVATE tiacc_e2e_lib)

add_executable(test_statistics tests/test_statistics.cpp)
target_link_libraries(test_statistics PRIVATE tiacc_e2e_lib)

add_executable(test_string_utils tests/test_string_utils.cpp)
target_link_libraries(test_string_utils PRIVATE tiacc_e2e_lib)

# 测试目标
enable_testing()

add_test(NAME calculator_basic COMMAND test_calculator_basic)
add_test(NAME calculator_advanced COMMAND test_calculator_advanced)
add_test(NAME statistics COMMAND test_statistics)
add_test(NAME string_utils COMMAND test_string_utils)

# 自定义目标：运行所有测试
add_custom_target(run_all_tests
    COMMAND ${CMAKE_CTEST_COMMAND} --output-on-failure
    DEPENDS test_calculator_basic test_calculator_advanced test_statistics test_string_utils
    COMMENT "Running all tests"
)

# 输出构建信息
message(STATUS "Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "C++ Compiler: ${CMAKE_CXX_COMPILER}")
message(STATUS "Coverage enabled: ${ENABLE_COVERAGE}")
