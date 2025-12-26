@echo off
REM ============================================================
REM TiaCC 混合语言 (C# + C++) 端到端测试脚本
REM ============================================================
REM
REM 这个脚本演示 TiaCC 在混合语言项目中的使用：
REM   - C++ 原生库编译并收集覆盖率 (LLVM)
REM   - C# 托管代码通过 P/Invoke 调用原生库
REM   - 使用 Coverlet 收集 C# 覆盖率
REM   - 合并两种覆盖率数据到统一的映射数据库
REM

setlocal enabledelayedexpansion

echo ============================================================
echo TiaCC Mixed Language E2E Test (C# + C++)
echo ============================================================
echo.

REM 设置路径
set PROJECT_DIR=%~dp0
set NATIVE_DIR=%PROJECT_DIR%native
set MANAGED_DIR=%PROJECT_DIR%managed
set COVERAGE_DIR=%PROJECT_DIR%coverage_data
set BUILD_DIR=%NATIVE_DIR%\build
set DB_PATH=%PROJECT_DIR%impact_map.db
set TOOLS_NODE_DIR=%PROJECT_DIR%..\..\..\tools-node

REM 设置 Visual Studio 环境
call "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
if %ERRORLEVEL% neq 0 (
    call "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
)
if %ERRORLEVEL% neq 0 (
    call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
)

echo.
echo Project Directory: %PROJECT_DIR%
echo Native Build: %BUILD_DIR%
echo Managed Solution: %MANAGED_DIR%
echo Coverage Output: %COVERAGE_DIR%
echo.

REM ============================================================
echo Step 1: Building C++ Native Library with Coverage
echo ============================================================

if exist "%BUILD_DIR%" rmdir /s /q "%BUILD_DIR%"
mkdir "%BUILD_DIR%"
cd /d "%BUILD_DIR%"

cmake .. -G "Ninja" ^
    -DCMAKE_C_COMPILER=clang ^
    -DCMAKE_CXX_COMPILER=clang++ ^
    -DCMAKE_BUILD_TYPE=Debug ^
    -DENABLE_COVERAGE=ON

if %ERRORLEVEL% neq 0 (
    echo CMake configuration failed!
    exit /b 1
)

cmake --build .

if %ERRORLEVEL% neq 0 (
    echo C++ build failed!
    exit /b 1
)

echo.
echo C++ native library built successfully!
echo.

REM ============================================================
echo Step 2: Building C# Solution
echo ============================================================

cd /d "%MANAGED_DIR%"

REM 复制原生库到 C# 输出目录
copy "%BUILD_DIR%\native_lib.dll" "%MANAGED_DIR%\MixedApp\bin\Debug\net8.0\" 2>nul
copy "%BUILD_DIR%\native_lib.dll" "%MANAGED_DIR%\MixedApp.Tests\bin\Debug\net8.0\" 2>nul

dotnet restore
if %ERRORLEVEL% neq 0 (
    echo dotnet restore failed!
    exit /b 1
)

dotnet build --configuration Debug
if %ERRORLEVEL% neq 0 (
    echo dotnet build failed!
    exit /b 1
)

REM 确保原生库在输出目录
copy "%BUILD_DIR%\native_lib.dll" "%MANAGED_DIR%\MixedApp\bin\Debug\net8.0\" 2>nul
copy "%BUILD_DIR%\native_lib.dll" "%MANAGED_DIR%\MixedApp.Tests\bin\Debug\net8.0\" 2>nul

echo.
echo C# solution built successfully!
echo.

REM ============================================================
echo Step 3: Creating Coverage Directory
echo ============================================================

if exist "%COVERAGE_DIR%" rmdir /s /q "%COVERAGE_DIR%"
mkdir "%COVERAGE_DIR%"

REM ============================================================
echo Step 4: Running Tests and Collecting Coverage
echo ============================================================

echo.
echo 4a. Running C# tests with Coverlet...
cd /d "%MANAGED_DIR%"

REM 设置 LLVM 覆盖率输出路径 (用于 C++ 部分)
set LLVM_PROFILE_FILE=%COVERAGE_DIR%\csharp_test_%%p.profraw

dotnet test ^
    /p:CollectCoverage=true ^
    /p:CoverletOutputFormat=json ^
    /p:CoverletOutput="%COVERAGE_DIR%\csharp.coverage.json" ^
    /p:Include="[MixedApp]*" ^
    --no-build ^
    --logger "console;verbosity=normal"

if %ERRORLEVEL% neq 0 (
    echo Some tests failed! Continuing anyway...
)

REM 移动覆盖率文件
if exist "%MANAGED_DIR%\MixedApp.Tests\%COVERAGE_DIR%\csharp.coverage.json" (
    move "%MANAGED_DIR%\MixedApp.Tests\%COVERAGE_DIR%\csharp.coverage.json" "%COVERAGE_DIR%\"
)

echo.
echo C# test coverage collected!
echo.

REM ============================================================
echo Step 5: Processing C++ Coverage Data
echo ============================================================

cd /d "%COVERAGE_DIR%"

REM 查找 profraw 文件
for %%f in (*.profraw) do (
    echo Processing %%f...
    
    llvm-profdata merge -sparse "%%f" -o "%%~nf.profdata"
    
    if exist "%%~nf.profdata" (
        llvm-cov export "%BUILD_DIR%\native_lib.dll" ^
            -instr-profile="%%~nf.profdata" ^
            -format=text > "%%~nf.cov.json"
        
        echo   Generated: %%~nf.cov.json
    )
)

echo.
echo C++ coverage processed!
echo.

REM ============================================================
echo Step 6: Building Impact Map Database
echo ============================================================

cd /d "%TOOLS_NODE_DIR%"

REM 删除旧数据库
if exist "%DB_PATH%" del "%DB_PATH%"

REM 检查并安装依赖
if not exist node_modules (
    echo Installing tools-node dependencies...
    call npm install
)

echo.
echo Building impact map from coverage data...
call npx tsx src/cli/mapper.ts build ^
    --coverage-dir "%COVERAGE_DIR%" ^
    --db "%DB_PATH%" ^
    --verbose

if not exist "%DB_PATH%" (
    echo Failed to create impact map database!
    exit /b 1
)

echo.
echo Impact map database created: %DB_PATH%
echo.

REM ============================================================
echo Step 7: Verifying Recommendations
echo ============================================================

echo.
echo [Query: math_engine.cpp - C++ native code]
call npx tsx src/cli/mapper.ts query math_engine.cpp --db "%DB_PATH%"

echo.
echo [Query: string_processor.cpp - C++ native code]
call npx tsx src/cli/mapper.ts query string_processor.cpp --db "%DB_PATH%"

echo.
echo [Query: MathService.cs - C# managed code]
call npx tsx src/cli/mapper.ts query MathService.cs --db "%DB_PATH%"

echo.
echo [Query: StringService.cs - C# managed code]
call npx tsx src/cli/mapper.ts query StringService.cs --db "%DB_PATH%"

echo.
echo [Query: NativeInterop.cs - P/Invoke declarations]
call npx tsx src/cli/mapper.ts query NativeInterop.cs --db "%DB_PATH%"

echo.

REM ============================================================
echo Step 8: Database Statistics
echo ============================================================

call npx tsx src/cli/mapper.ts stats --db "%DB_PATH%"

echo.
echo ============================================================
echo Mixed Language E2E Test Complete!
echo ============================================================
echo.

cd /d "%PROJECT_DIR%"
