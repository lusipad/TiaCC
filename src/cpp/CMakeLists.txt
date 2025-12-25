# TiaCC C++ Coverage Module
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# Coverage Library
# ------------------------------------------------------------------------------
add_library(tia_coverage STATIC
    src/coverage_api.cpp
    src/platform/common.cpp
)

target_include_directories(tia_coverage
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
)

target_link_libraries(tia_coverage
    PRIVATE
        nlohmann_json::nlohmann_json
)

# Platform-specific sources and libraries
if(WIN32)
    target_sources(tia_coverage PRIVATE src/platform/windows.cpp)
    target_link_libraries(tia_coverage PRIVATE shlwapi)
elseif(APPLE)
    target_sources(tia_coverage PRIVATE src/platform/macos.cpp)
else()
    target_sources(tia_coverage PRIVATE src/platform/linux.cpp)
endif()

# ------------------------------------------------------------------------------
# IPC Server Library
# ------------------------------------------------------------------------------
add_library(tia_ipc_server STATIC
    src/ipc_server.cpp
)

target_include_directories(tia_ipc_server
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
)

target_link_libraries(tia_ipc_server
    PUBLIC
        tia_coverage
        asio
        nlohmann_json::nlohmann_json
)

# ------------------------------------------------------------------------------
# Coverage Service Executable (standalone server)
# ------------------------------------------------------------------------------
add_executable(tia_coverage_service
    src/main.cpp
)

target_link_libraries(tia_coverage_service
    PRIVATE
        tia_ipc_server
)

# Set output name
set_target_properties(tia_coverage_service PROPERTIES
    OUTPUT_NAME "tia-coverage-service"
)
