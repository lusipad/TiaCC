# TiaCC C++ Tests
# ------------------------------------------------------------------------------

# Fetch GoogleTest
include(FetchContent)
FetchContent_Declare(
    googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG v1.14.0
)
# For Windows: Prevent overriding the parent project's compiler/linker settings
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

# Test executable
add_executable(tia_tests
    test_coverage_api.cpp
    test_ipc_server.cpp
)

target_link_libraries(tia_tests
    PRIVATE
        tia_coverage
        tia_ipc_server
        GTest::gtest_main
        GTest::gmock
)

# Register tests with CTest
include(GoogleTest)
gtest_discover_tests(tia_tests)
