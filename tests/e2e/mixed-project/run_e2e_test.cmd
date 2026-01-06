@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM TiaCC 混合语言 (C# + C++) 端到端测试脚本
REM ============================================================
REM
REM 这个脚本演示 TiaCC 在混合语言项目中的使用：
REM   - C++ 原生库编译并收集覆盖率 (LLVM)
REM   - C# 托管代码通过 P/Invoke 调用原生库
REM   - 对每个测试类单独运行并收集覆盖率（Coverlet + LLVM）
REM   - 将两种覆盖率映射合并到统一的 impact map DB
REM

echo ============================================================
echo TiaCC Mixed Language E2E Test (C# + C++)
echo ============================================================
echo.

REM Paths
set "PROJECT_DIR=%~dp0"
for %%I in ("%PROJECT_DIR%..\..\..") do set "REPO_ROOT=%%~fI"
set "CLI_PROJECT=%REPO_ROOT%\src\cli\dotnet\TiaCC.Cli\TiaCC.Cli.csproj"

set "NATIVE_DIR=%PROJECT_DIR%native"
set "MANAGED_DIR=%PROJECT_DIR%managed"
set "COVERAGE_DIR=%PROJECT_DIR%coverage_data"
set "BUILD_DIR=%NATIVE_DIR%\build"
set "DB_PATH=%PROJECT_DIR%impact_map.db"
set "TEST_CLASSES=MathServiceTests StringServiceTests IntegrationTests"

REM Setup Visual Studio environment
call "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
if %ERRORLEVEL% neq 0 (
  call "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
)
if %ERRORLEVEL% neq 0 (
  call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
)

echo Project Directory: %PROJECT_DIR%
echo Repo Root:         %REPO_ROOT%
echo Native Build:      %BUILD_DIR%
echo Managed Solution:  %MANAGED_DIR%
echo Coverage Output:   %COVERAGE_DIR%
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

REM Ensure native DLL is present for test runs
copy "%BUILD_DIR%\native_lib.dll" "%MANAGED_DIR%\MixedApp\bin\Debug\net8.0\" >nul 2>&1
copy "%BUILD_DIR%\native_lib.dll" "%MANAGED_DIR%\MixedApp.Tests\bin\Debug\net8.0\" >nul 2>&1

echo.
echo C# solution built successfully!
echo.

REM ============================================================
echo Step 3: Creating Coverage Directory
echo ============================================================

if exist "%COVERAGE_DIR%" rmdir /s /q "%COVERAGE_DIR%"
mkdir "%COVERAGE_DIR%"

REM ============================================================
echo Step 4: Running Tests (per class) and Collecting Coverage
echo ============================================================

cd /d "%MANAGED_DIR%"

for %%T in (%TEST_CLASSES%) do (
  echo.
  echo Running test class: %%T

  del /q "%COVERAGE_DIR%\native_%%T_*.profraw" 2>nul
  set "LLVM_PROFILE_FILE=%COVERAGE_DIR%\native_%%T_%%p.profraw"

  dotnet test ^
    /p:CollectCoverage=true ^
    /p:CoverletOutputFormat=json ^
    /p:CoverletOutput="%COVERAGE_DIR%\managed_%%T.coverage.json" ^
    /p:Include="[MixedApp]*" ^
    --filter "FullyQualifiedName~%%T" ^
    --no-build ^
    --logger "console;verbosity=normal"

  if !ERRORLEVEL! neq 0 (
    echo Some tests failed for %%T! Continuing anyway...
  )

  set "PROFRAW_ARGS="
  for %%F in ("%COVERAGE_DIR%\native_%%T_*.profraw") do set "PROFRAW_ARGS=!PROFRAW_ARGS! \"%%~fF\""

  if "!PROFRAW_ARGS!"=="" (
    echo No native profraw generated for %%T
  ) else (
    llvm-profdata merge -sparse !PROFRAW_ARGS! -o "%COVERAGE_DIR%\native_%%T.profdata"
    if !ERRORLEVEL! neq 0 (
      echo llvm-profdata merge failed for %%T
      exit /b 1
    )

    llvm-cov export "%BUILD_DIR%\native_lib.dll" ^
      -instr-profile="%COVERAGE_DIR%\native_%%T.profdata" ^
      -format=text > "%COVERAGE_DIR%\native_%%T.coverage.json"

    if !ERRORLEVEL! neq 0 (
      echo llvm-cov export failed for %%T
      exit /b 1
    )

    echo   Generated: native_%%T.coverage.json
  )
)

echo.
echo Coverage collection complete!
echo.

REM ============================================================
echo Step 5: Building Impact Map Database
echo ============================================================

if exist "%DB_PATH%" del "%DB_PATH%"

echo Initializing database...
dotnet run --project "%CLI_PROJECT%" -c Release -- init --db "%DB_PATH%"
if %ERRORLEVEL% neq 0 (
  echo Failed to initialize impact map database!
  exit /b 1
)

echo.
echo Mapping coverage into database...
for %%T in (%TEST_CLASSES%) do (
  if exist "%COVERAGE_DIR%\managed_%%T.coverage.json" (
    dotnet run --project "%CLI_PROJECT%" -c Release -- map ^
      --db "%DB_PATH%" ^
      --coverage "%COVERAGE_DIR%\managed_%%T.coverage.json" ^
      --test "%%T" ^
      --base-dir "%REPO_ROOT%"
    if !ERRORLEVEL! neq 0 exit /b 1
  )

  if exist "%COVERAGE_DIR%\native_%%T.coverage.json" (
    dotnet run --project "%CLI_PROJECT%" -c Release -- map ^
      --db "%DB_PATH%" ^
      --coverage "%COVERAGE_DIR%\native_%%T.coverage.json" ^
      --test "%%T" ^
      --base-dir "%REPO_ROOT%"
    if !ERRORLEVEL! neq 0 exit /b 1
  )
)

echo.
echo Impact map database created: %DB_PATH%
echo.

REM ============================================================
echo Step 6: Verifying Recommendations
echo ============================================================

echo.
echo [Query: math_engine.cpp - C++ native code]
dotnet run --project "%CLI_PROJECT%" -c Release -- query --db "%DB_PATH%" --files "tests/e2e/mixed-project/native/src/math_engine.cpp"

echo.
echo [Query: string_processor.cpp - C++ native code]
dotnet run --project "%CLI_PROJECT%" -c Release -- query --db "%DB_PATH%" --files "tests/e2e/mixed-project/native/src/string_processor.cpp"

echo.
echo [Query: MathService.cs - C# managed code]
dotnet run --project "%CLI_PROJECT%" -c Release -- query --db "%DB_PATH%" --files "tests/e2e/mixed-project/managed/MixedApp/MathService.cs"

echo.
echo [Query: StringService.cs - C# managed code]
dotnet run --project "%CLI_PROJECT%" -c Release -- query --db "%DB_PATH%" --files "tests/e2e/mixed-project/managed/MixedApp/StringService.cs"

echo.
echo [Query: NativeInterop.cs - P/Invoke declarations]
dotnet run --project "%CLI_PROJECT%" -c Release -- query --db "%DB_PATH%" --files "tests/e2e/mixed-project/managed/MixedApp/NativeInterop.cs"

echo.

REM ============================================================
echo Step 7: Database Statistics
echo ============================================================

dotnet run --project "%CLI_PROJECT%" -c Release -- stats --db "%DB_PATH%"

echo.
echo ============================================================
echo Mixed Language E2E Test Complete!
echo ============================================================
echo.

cd /d "%PROJECT_DIR%"
endlocal
