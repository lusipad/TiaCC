@echo off
REM TiaCC C++ E2E 测试 - 使用 VS Developer 环境
REM 这个脚本在 VS Developer Command Prompt 环境中运行 E2E 测试

echo ============================================================
echo TiaCC C++ End-to-End Test
echo ============================================================

REM 设置 Visual Studio 环境
call "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"

REM 设置 LLVM 路径
set LLVM_PATH=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\Llvm\x64\bin
set PATH=%LLVM_PATH%;%PATH%

echo.
echo LLVM Path: %LLVM_PATH%
echo.

REM 检查工具
echo Checking tools...
clang++ --version
echo.
llvm-profdata --version
echo.

REM 进入项目目录
cd /d %~dp0

REM 清理并创建构建目录
if exist build rmdir /s /q build
mkdir build
cd build

echo.
echo ============================================================
echo Step 1: Configuring CMake...
echo ============================================================

cmake .. -G "Ninja" ^
    -DCMAKE_C_COMPILER=clang ^
    -DCMAKE_CXX_COMPILER=clang++ ^
    -DCMAKE_BUILD_TYPE=Debug ^
    -DENABLE_COVERAGE=ON

if %ERRORLEVEL% neq 0 (
    echo CMake configuration failed!
    exit /b 1
)

echo.
echo ============================================================
echo Step 2: Building...
echo ============================================================

cmake --build . --parallel

if %ERRORLEVEL% neq 0 (
    echo Build failed!
    exit /b 1
)

echo.
echo Build completed successfully!

REM 返回项目目录
cd ..

REM 创建覆盖率目录
if exist coverage_data rmdir /s /q coverage_data
mkdir coverage_data

echo.
echo ============================================================
echo Step 3: Running tests and collecting coverage...
echo ============================================================

REM 运行测试并收集覆盖率
echo Running test_calculator_basic...
set LLVM_PROFILE_FILE=coverage_data\test_calculator_basic.profraw
build\test_calculator_basic.exe
if %ERRORLEVEL% neq 0 (
    echo Test failed!
    exit /b 1
)

echo.
echo Running test_calculator_advanced...
set LLVM_PROFILE_FILE=coverage_data\test_calculator_advanced.profraw
build\test_calculator_advanced.exe
if %ERRORLEVEL% neq 0 (
    echo Test failed!
    exit /b 1
)

echo.
echo Running test_statistics...
set LLVM_PROFILE_FILE=coverage_data\test_statistics.profraw
build\test_statistics.exe
if %ERRORLEVEL% neq 0 (
    echo Test failed!
    exit /b 1
)

echo.
echo Running test_string_utils...
set LLVM_PROFILE_FILE=coverage_data\test_string_utils.profraw
build\test_string_utils.exe
if %ERRORLEVEL% neq 0 (
    echo Test failed!
    exit /b 1
)

echo.
echo All tests passed!

echo.
echo ============================================================
echo Step 4: Processing coverage data...
echo ============================================================

REM 处理每个覆盖率文件
for %%t in (test_calculator_basic test_calculator_advanced test_statistics test_string_utils) do (
    echo Processing %%t...
    llvm-profdata merge -sparse coverage_data\%%t.profraw -o coverage_data\%%t.profdata
    REM Export JSON with functions included (default format is JSON)
    llvm-cov export build\%%t.exe -instr-profile=coverage_data\%%t.profdata > coverage_data\%%t.cov.json
    llvm-cov report build\%%t.exe -instr-profile=coverage_data\%%t.profdata > coverage_data\%%t.report.txt
    echo   Generated: coverage_data\%%t.cov.json
)

echo.
echo Coverage processing complete!
echo.

echo ============================================================
echo Step 5: Building impact map...
echo ============================================================

REM 进入 tools-node 目录
cd ..\..\..\tools-node

REM 检查是否需要安装依赖
if not exist node_modules (
    echo Installing tools-node dependencies...
    call npm install
)

REM 删除旧数据库
set DB_PATH=..\tests\e2e\cpp-project\impact_map.db
if exist %DB_PATH% del %DB_PATH%

REM 运行 mapper
echo Building impact map database...
call npx tsx src/cli/mapper.ts build ^
    --coverage-dir ..\tests\e2e\cpp-project\coverage_data ^
    --db %DB_PATH% ^
    --base-path ..\tests\e2e\cpp-project ^
    --verbose

if not exist %DB_PATH% (
    echo Failed to create database!
    exit /b 1
)

echo.
echo Database created: %DB_PATH%

echo.
echo ============================================================
echo Step 6: Verifying recommendations...
echo ============================================================

echo.
echo Query: Which tests cover calculator.cpp?
call npx tsx src/cli/mapper.ts query calculator.cpp --db %DB_PATH%

echo.
echo Query: Which tests cover statistics.cpp?
call npx tsx src/cli/mapper.ts query statistics.cpp --db %DB_PATH%

echo.
echo Query: Which tests cover string_utils.cpp?
call npx tsx src/cli/mapper.ts query string_utils.cpp --db %DB_PATH%

echo.
echo ============================================================
echo Database Statistics
echo ============================================================
call npx tsx src/cli/mapper.ts stats --db %DB_PATH%

echo.
echo ============================================================
echo E2E Test Complete!
echo ============================================================
echo.

cd ..\tests\e2e\cpp-project
