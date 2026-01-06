<#
.SYNOPSIS
    TiaCC C++ 端到端验证脚本

.DESCRIPTION
    这个脚本执行完整的 TiaCC 工作流验证：
    1. 使用 Clang 编译 C++ 项目并启用覆盖率
    2. 运行每个测试并收集独立的覆盖率数据
    3. 处理覆盖率数据并构建映射
    4. 验证变更推荐功能

.PARAMETER Step
    指定要运行的步骤: All, Build, Test, Process, Verify

.PARAMETER ClangPath
    Clang 编译器路径 (默认使用 PATH 中的)

.PARAMETER LLVMPath
    LLVM 工具路径 (默认使用 PATH 中的)

.EXAMPLE
    .\run_e2e_test.ps1
    .\run_e2e_test.ps1 -Step Build
    .\run_e2e_test.ps1 -Step Verify
#>

param(
    [ValidateSet("All", "Build", "Test", "Process", "Verify")]
    [string]$Step = "All",

    [string]$ClangPath = "",
    [string]$LLVMPath = ""
)

$ErrorActionPreference = "Stop"

# ============================================================================
# 配置
# ============================================================================

$ProjectRoot = $PSScriptRoot
$BuildDir = Join-Path $ProjectRoot "build"
$CoverageDir = Join-Path $ProjectRoot "coverage_data"
$DbPath = Join-Path $ProjectRoot "impact_map.db"
$RepoRoot = Split-Path (Split-Path (Split-Path $ProjectRoot))
$CliProject = Join-Path $RepoRoot "src\cli\dotnet\TiaCC.Cli\TiaCC.Cli.csproj"

# 自动检测 LLVM 路径
$DefaultLLVMPath = "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\Llvm\x64\bin"
if (-not $LLVMPath -and (Test-Path $DefaultLLVMPath)) {
    $LLVMPath = $DefaultLLVMPath
    $ClangPath = Join-Path $LLVMPath "clang++.exe"
}

# 备选路径
$AlternateLLVMPaths = @(
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Tools\Llvm\x64\bin",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\Llvm\x64\bin",
    "C:\Program Files\LLVM\bin"
)

if (-not $LLVMPath) {
    foreach ($path in $AlternateLLVMPaths) {
        if (Test-Path $path) {
            $LLVMPath = $path
            $ClangPath = Join-Path $LLVMPath "clang++.exe"
            break
        }
    }
}

# 颜色输出
function Write-Header($msg) {
    Write-Host "`n$("=" * 60)" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "$("=" * 60)`n" -ForegroundColor Cyan
}

function Write-Step($msg) {
    Write-Host ">>> $msg" -ForegroundColor Yellow
}

function Write-Success($msg) {
    Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-Error($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
}

function Write-Info($msg) {
    Write-Host "[INFO] $msg" -ForegroundColor Gray
}

# ============================================================================
# 步骤 1: 构建项目
# ============================================================================

function Invoke-Build {
    Write-Header "步骤 1: 构建项目 (使用 Clang + 覆盖率插桩)"

    # 检查 Clang
    $clang = if ($ClangPath -and (Test-Path $ClangPath)) { $ClangPath } else { "clang++" }
    $clangC = if ($LLVMPath) { Join-Path $LLVMPath "clang.exe" } else { "clang" }

    try {
        $version = & $clang --version 2>&1 | Select-Object -First 1
        Write-Info "使用编译器: $clang"
        Write-Info "版本: $version"
    }
    catch {
        Write-Error "找不到 Clang 编译器。请安装 LLVM 或指定 -ClangPath 参数"
        exit 1
    }

    # 创建构建目录
    if (Test-Path $BuildDir) {
        Remove-Item -Recurse -Force $BuildDir
    }
    New-Item -ItemType Directory -Path $BuildDir | Out-Null

    # 运行 CMake
    Write-Step "配置 CMake..."
    Push-Location $BuildDir
    try {
        # 使用完整路径的编译器
        $cmakeArgs = @(
            "..",
            "-G", "Ninja",
            "-DCMAKE_C_COMPILER=$clangC",
            "-DCMAKE_CXX_COMPILER=$clang",
            "-DCMAKE_BUILD_TYPE=Debug",
            "-DENABLE_COVERAGE=ON"
        )

        Write-Info "CMake 参数: $($cmakeArgs -join ' ')"
        & cmake @cmakeArgs

        if ($LASTEXITCODE -ne 0) {
            Write-Error "CMake 配置失败"
            exit 1
        }

        Write-Step "编译项目..."
        cmake --build . --parallel

        if ($LASTEXITCODE -ne 0) {
            Write-Error "编译失败"
            exit 1
        }

        Write-Success "项目编译完成"
    }
    finally {
        Pop-Location
    }
}

# ============================================================================
# 步骤 2: 运行测试并收集覆盖率
# ============================================================================

function Invoke-Tests {
    Write-Header "步骤 2: 运行测试并收集覆盖率"

    # 创建覆盖率目录
    if (Test-Path $CoverageDir) {
        Remove-Item -Recurse -Force $CoverageDir
    }
    New-Item -ItemType Directory -Path $CoverageDir | Out-Null

    # 测试列表
    $tests = @(
        @{ Name = "test_calculator_basic"; Exe = "test_calculator_basic.exe" },
        @{ Name = "test_calculator_advanced"; Exe = "test_calculator_advanced.exe" },
        @{ Name = "test_statistics"; Exe = "test_statistics.exe" },
        @{ Name = "test_string_utils"; Exe = "test_string_utils.exe" }
    )

    $passed = 0
    $failed = 0

    foreach ($test in $tests) {
        Write-Step "运行测试: $($test.Name)"

        $exePath = Join-Path $BuildDir $test.Exe
        $profrawPath = Join-Path $CoverageDir "$($test.Name).profraw"

        # 设置 LLVM 覆盖率输出路径
        $env:LLVM_PROFILE_FILE = $profrawPath

        try {
            # 运行测试
            $result = & $exePath
            $exitCode = $LASTEXITCODE

            if ($exitCode -eq 0) {
                Write-Success "$($test.Name) 通过"
                $passed++

                # 验证 profraw 文件生成
                if (Test-Path $profrawPath) {
                    $size = (Get-Item $profrawPath).Length
                    Write-Info "覆盖率数据: $profrawPath ($size bytes)"
                }
                else {
                    Write-Error "未生成覆盖率文件: $profrawPath"
                }
            }
            else {
                Write-Error "$($test.Name) 失败 (退出码: $exitCode)"
                $failed++
            }
        }
        catch {
            Write-Error "$($test.Name) 执行出错: $_"
            $failed++
        }
    }

    # 清理环境变量
    Remove-Item Env:LLVM_PROFILE_FILE -ErrorAction SilentlyContinue

    Write-Info "测试结果: $passed 通过, $failed 失败"

    if ($failed -gt 0) {
        Write-Error "有测试失败"
        exit 1
    }
}

# ============================================================================
# 步骤 3: 处理覆盖率数据
# ============================================================================

function Invoke-ProcessCoverage {
    Write-Header "步骤 3: 处理覆盖率数据"

    # 检查 LLVM 工具
    $llvmProfdata = if ($LLVMPath) { Join-Path $LLVMPath "llvm-profdata" } else { "llvm-profdata" }
    $llvmCov = if ($LLVMPath) { Join-Path $LLVMPath "llvm-cov" } else { "llvm-cov" }

    try {
        & $llvmProfdata show --version 2>&1 | Out-Null
    }
    catch {
        Write-Error "找不到 llvm-profdata。请安装 LLVM 或指定 -LLVMPath 参数"
        exit 1
    }

    # 获取所有 profraw 文件
    $profrawFiles = Get-ChildItem -Path $CoverageDir -Filter "*.profraw"
    Write-Info "找到 $($profrawFiles.Count) 个覆盖率文件"

    foreach ($profraw in $profrawFiles) {
        $testName = $profraw.BaseName
        $profdataPath = Join-Path $CoverageDir "$testName.profdata"
        $jsonPath = Join-Path $CoverageDir "$testName.coverage.json"

        Write-Step "处理: $testName"

        # 合并 profraw 到 profdata
        Write-Info "  转换为 profdata..."
        & $llvmProfdata merge -sparse $profraw.FullName -o $profdataPath

        if (-not (Test-Path $profdataPath)) {
            Write-Error "  无法生成 profdata 文件"
            continue
        }

        # 获取可执行文件用于导出
        $exePath = Join-Path $BuildDir "$testName.exe"

        # 导出为 JSON 格式
        Write-Info "  导出覆盖率 JSON..."
        & $llvmCov export $exePath -instr-profile=$profdataPath -format=text | Out-File -FilePath $jsonPath -Encoding utf8

        if (Test-Path $jsonPath) {
            $size = (Get-Item $jsonPath).Length
            Write-Success "  生成: $jsonPath ($size bytes)"
        }

        # 也生成可读的覆盖率报告
        $reportPath = Join-Path $CoverageDir "$testName.report.txt"
        & $llvmCov report $exePath -instr-profile=$profdataPath | Out-File -FilePath $reportPath -Encoding utf8
        Write-Info "  报告: $reportPath"
    }

    Write-Success "覆盖率数据处理完成"
}

# ============================================================================
# 步骤 4: 构建映射数据库
# ============================================================================

function Invoke-BuildMapping {
    Write-Header "步骤 4: 构建映射数据库"

    if (Test-Path $DbPath) {
        Remove-Item $DbPath
    }

    $coverageFiles = Get-ChildItem $CoverageDir -Filter "*.coverage.json" -File | Sort-Object FullName
    if (-not $coverageFiles) {
        Write-Error "未找到覆盖率文件: $CoverageDir\*.coverage.json"
        exit 1
    }

    Write-Step "初始化数据库..."
    dotnet run --project $CliProject -c Release -- init --db $DbPath
    if ($LASTEXITCODE -ne 0) { throw "dotnet init failed ($LASTEXITCODE)" }

    foreach ($coverageFile in $coverageFiles) {
        $testName = ($coverageFile.BaseName -replace '\.coverage$', '')
        Write-Step "映射覆盖率: $testName"
        dotnet run --project $CliProject -c Release -- map `
            --db $DbPath `
            --coverage $coverageFile.FullName `
            --test $testName `
            --base-dir $RepoRoot
        if ($LASTEXITCODE -ne 0) { throw "dotnet map failed for $testName ($LASTEXITCODE)" }
    }

    if (-not (Test-Path $DbPath)) {
        Write-Error "数据库创建失败"
        exit 1
    }

    $size = (Get-Item $DbPath).Length
    Write-Success "数据库已创建: $DbPath ($size bytes)"

    Write-Step "数据库统计:"
    dotnet run --project $CliProject -c Release -- stats --db $DbPath
    if ($LASTEXITCODE -ne 0) { throw "dotnet stats failed ($LASTEXITCODE)" }
}

# ============================================================================
# 步骤 5: 验证推荐功能
# ============================================================================

function Invoke-Verify {
    Write-Header "步骤 5: 验证推荐功能"

    # 测试场景
    $scenarios = @(
        @{
            Description   = "修改 calculator.cpp"
            File          = "tests/e2e/cpp-project/src/calculator.cpp"
            ExpectedTests = @("test_calculator_basic", "test_calculator_advanced")
        },
        @{
            Description   = "修改 statistics.cpp"
            File          = "tests/e2e/cpp-project/src/statistics.cpp"
            ExpectedTests = @("test_statistics")
        },
        @{
            Description   = "修改 string_utils.cpp"
            File          = "tests/e2e/cpp-project/src/string_utils.cpp"
            ExpectedTests = @("test_string_utils", "test_statistics")
        }
    )

    $allPassed = $true

    foreach ($scenario in $scenarios) {
        Write-Step "场景: $($scenario.Description)"

        $result = dotnet run --project $CliProject -c Release -- query --db $DbPath --files $scenario.File 2>&1
        if ($LASTEXITCODE -ne 0) { throw "dotnet query failed ($LASTEXITCODE)" }

        Write-Info "查询结果:"
        Write-Host $result

        $allExpectedFound = $true
        foreach ($expectedTest in $scenario.ExpectedTests) {
            if ($result -match [regex]::Escape($expectedTest)) {
                Write-Success "  找到预期测试: $expectedTest"
            }
            else {
                Write-Error "  未找到预期测试: $expectedTest"
                $allExpectedFound = $false
            }
        }

        if (-not $allExpectedFound) {
            $allPassed = $false
        }

        Write-Host ""
    }

    # 导出数据用于 Dashboard
    Write-Step "导出数据到 Dashboard..."
    $dashboardDataDir = Join-Path $ProjectRoot "dashboard_data"
    if (-not (Test-Path $dashboardDataDir)) {
        New-Item -ItemType Directory -Path $dashboardDataDir | Out-Null
    }

    dotnet run --project $CliProject -c Release -- export --db $DbPath --output $dashboardDataDir
    if ($LASTEXITCODE -ne 0) { throw "dotnet export failed ($LASTEXITCODE)" }

    if ($allPassed) {
        Write-Success "所有验证场景通过!"
    }
    else {
        Write-Error "部分验证场景失败"
        exit 1
    }
}

# ============================================================================
# 主程序
# ============================================================================

Write-Host @"

  _____ _        ____ ____    _____  ____  _____   _____         _
 |_   _(_) __ _ / ___/ ___|  | ____|___ \| ____| |_   _|__  ___| |_
   | | | |/ _` | |  | |      |  _|   __) |  _|     | |/ _ \/ __| __|
   | | | | (_| | |__| |___   | |___ / __/| |___    | |  __/\__ \ |_
   |_| |_|\__,_|\____\____|  |_____|_____|_____|   |_|\___||___/\__|

                    C++ 端到端验证脚本

"@ -ForegroundColor Magenta

Write-Info "项目目录: $ProjectRoot"
Write-Info "构建目录: $BuildDir"
Write-Info "覆盖率目录: $CoverageDir"
Write-Info "数据库路径: $DbPath"
Write-Info "LLVM 路径: $(if ($LLVMPath) { $LLVMPath } else { '(使用 PATH)' })"
Write-Info "执行步骤: $Step"
Write-Host ""

try {
    switch ($Step) {
        "All" {
            Invoke-Build
            Invoke-Tests
            Invoke-ProcessCoverage
            Invoke-BuildMapping
            Invoke-Verify
        }
        "Build" {
            Invoke-Build
        }
        "Test" {
            Invoke-Tests
        }
        "Process" {
            Invoke-ProcessCoverage
            Invoke-BuildMapping
        }
        "Verify" {
            Invoke-Verify
        }
    }

    Write-Header "端到端测试完成!"
    Write-Success "所有步骤执行成功"

}
catch {
    Write-Error "执行失败: $_"
    Write-Host $_.ScriptStackTrace -ForegroundColor Red
    exit 1
}
