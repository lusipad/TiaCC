cmake_minimum_required(VERSION 3.20)
project(TiaCC VERSION 1.0.0 LANGUAGES CXX)

# ------------------------------------------------------------------------------
# Global Settings
# ------------------------------------------------------------------------------
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Output directories
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)

# ------------------------------------------------------------------------------
# Coverage Flags (Clang only)
# ------------------------------------------------------------------------------
option(TIA_ENABLE_COVERAGE "Enable code coverage instrumentation" OFF)

if(TIA_ENABLE_COVERAGE)
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
        message(STATUS "Coverage instrumentation enabled (Clang)")
        add_compile_options(-fprofile-instr-generate -fcoverage-mapping)
        add_link_options(-fprofile-instr-generate)
    else()
        message(WARNING "Coverage instrumentation requires Clang compiler")
    endif()
endif()

# ------------------------------------------------------------------------------
# Platform Detection
# ------------------------------------------------------------------------------
if(WIN32)
    set(TIA_PLATFORM "windows")
    add_definitions(-DTIA_PLATFORM_WINDOWS)
elseif(APPLE)
    set(TIA_PLATFORM "macos")
    add_definitions(-DTIA_PLATFORM_MACOS)
elseif(UNIX)
    set(TIA_PLATFORM "linux")
    add_definitions(-DTIA_PLATFORM_LINUX)
endif()

message(STATUS "TiaCC Platform: ${TIA_PLATFORM}")

# ------------------------------------------------------------------------------
# Dependencies
# ------------------------------------------------------------------------------
# nlohmann/json - Header-only JSON library
include(FetchContent)

FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)
FetchContent_MakeAvailable(json)

# asio - Standalone (non-Boost) networking library
FetchContent_Declare(
    asio
    GIT_REPOSITORY https://github.com/chriskohlhoff/asio.git
    GIT_TAG asio-1-28-0
)
FetchContent_MakeAvailable(asio)

# Create interface target for asio
add_library(asio INTERFACE)
target_include_directories(asio INTERFACE ${asio_SOURCE_DIR}/asio/include)
target_compile_definitions(asio INTERFACE ASIO_STANDALONE)

# Platform-specific threading
if(WIN32)
    target_link_libraries(asio INTERFACE ws2_32 wsock32)
else()
    find_package(Threads REQUIRED)
    target_link_libraries(asio INTERFACE Threads::Threads)
endif()

# ------------------------------------------------------------------------------
# Subdirectories
# ------------------------------------------------------------------------------
add_subdirectory(src/core/cpp)

# ------------------------------------------------------------------------------
# Testing (optional)
# ------------------------------------------------------------------------------
option(TIA_BUILD_TESTS "Build unit tests" ON)
if(TIA_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests/cpp)
endif()

# ------------------------------------------------------------------------------
# Installation
# ------------------------------------------------------------------------------
include(GNUInstallDirs)

install(TARGETS tia_coverage tia_ipc_server
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
)

install(DIRECTORY src/core/cpp/include/
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)
