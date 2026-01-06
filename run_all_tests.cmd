@echo off
REM ============================================================
REM TiaCC One-Click End-to-End Test Script
REM ============================================================

setlocal enabledelayedexpansion

echo.
echo  _____  _        ____   ____
echo ^|_   _^|(_) __ _ / ___^| / ___^|
echo   ^| ^|  ^| ^|/ _` ^| ^|    ^| ^|
echo   ^| ^|  ^| ^| (_^| ^| ^|___ ^| ^|___
echo   ^|_^|  ^|_^|\__,_^|\____^| \____^|
echo.
echo    End-to-End Test Suite
echo ============================================================
echo.

REM Set paths
set E2E_DIR=%~dp0tests\e2e
set CPP_PROJECT=%E2E_DIR%\cpp-project
set CLI_PROJECT=%~dp0src\cli\dotnet\TiaCC.Cli\TiaCC.Cli.csproj
set DASHBOARD_DATA_DIR=%~dp0src\dashboard\dotnet\TiaCC.Dashboard\wwwroot\data
set REPORT_DIR=%~dp0test-reports

REM Create report directory
if not exist "%REPORT_DIR%" mkdir "%REPORT_DIR%"

REM Setup Visual Studio environment
echo [Step 0] Setting up Visual Studio environment...
call "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    call "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
)
if %ERRORLEVEL% neq 0 (
    call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
)

echo.
echo ============================================================
echo [Step 1] Running C++ E2E Tests
echo ============================================================
echo.

REM Run C++ tests
cd /d "%CPP_PROJECT%"
call run_e2e_test.cmd > "%REPORT_DIR%\cpp-project.log" 2>&1
set CPP_RESULT=%ERRORLEVEL%

if %CPP_RESULT% equ 0 (
    echo [PASS] C++ E2E tests passed!
) else (
    echo [FAIL] C++ E2E tests failed! See %REPORT_DIR%\cpp-project.log
)

echo.
echo ============================================================
echo [Step 2] Generating Reports
echo ============================================================
echo.

REM Export database statistics
echo Exporting database statistics...
dotnet run --project "%CLI_PROJECT%" -c Release -- stats --db "%CPP_PROJECT%\impact_map.db" > "%REPORT_DIR%\cpp-project-stats.txt" 2>&1

REM Export mapping data to JSON for Dashboard (Blazor)
echo Exporting mapping data for Dashboard...
if not exist "%DASHBOARD_DATA_DIR%" mkdir "%DASHBOARD_DATA_DIR%"
dotnet run --project "%CLI_PROJECT%" -c Release -- export --db "%CPP_PROJECT%\impact_map.db" --output "%DASHBOARD_DATA_DIR%" > "%REPORT_DIR%\cpp-project-export.log" 2>&1

echo Test data exported successfully!

echo.
echo ============================================================
echo [Step 3] Dashboard Ready
echo ============================================================
echo.

echo Dashboard data ready at: %DASHBOARD_DATA_DIR%\
echo.
echo Test Results:
echo   - C++ Project: %CPP_RESULT%
if %CPP_RESULT% equ 0 (
    echo   - Status: PASSED
) else (
    echo   - Status: FAILED
)

echo.
echo ============================================================
echo [Step 4] Starting Local Server
echo ============================================================
echo.

cd /d "%~dp0"

echo Starting Dashboard...
echo.
echo   Dashboard:    http://localhost:5000/
echo   Test Reports: %REPORT_DIR%
echo.
echo Press Ctrl+C to stop.
echo.

dotnet run --project src\dashboard\dotnet\TiaCC.Dashboard\TiaCC.Dashboard.csproj -c Release
