# TiaCC 端到端测试

[English](README.md) | [简体中文](README.zh.md)

本目录包含 TiaCC 系统的完整端到端验证测试，使用真实的代码和工具链。

## ✅ 支持的测试场景

| 场景 | 目录 | 描述 |
|------|------|------|
| **纯 C++ 项目** | `cpp-project/` | 使用 LLVM/Clang 覆盖率 |
| **混合语言项目** | `mixed-project/` | C# exe + C++ lib (P/Invoke) |

## 目录结构

```
tests/e2e/
├── cpp-project/               # 纯 C++ 项目验证
│   ├── src/                   # C++ 源代码
│   ├── tests/                 # C++ 测试用例
│   ├── CMakeLists.txt
│   └── run_e2e_test.cmd
├── mixed-project/             # 混合语言项目验证 ⭐ 新增
│   ├── native/                # C++ 原生库
│   │   ├── src/
│   │   │   ├── math_engine.cpp/.h
│   │   │   └── string_processor.cpp/.h
│   │   └── CMakeLists.txt
│   ├── managed/               # C# 托管代码
│   │   ├── MixedApp/          # 主应用 (P/Invoke)
│   │   ├── MixedApp.Tests/    # xUnit 测试
│   │   └── MixedApp.sln
│   └── run_e2e_test.cmd
├── fixtures/                  # 测试数据
└── README.md
```

## 📊 验证结果

### 纯 C++ 项目 (`cpp-project`)

| 修改的文件 | 推荐的测试 | 状态 |
|-----------|-----------|------|
| `calculator.cpp` | `test_calculator_basic`, `test_calculator_advanced` | ✅ |
| `statistics.cpp` | `test_statistics` | ✅ |
| `string_utils.cpp` | `test_string_utils`, `test_statistics` | ✅ |

### 混合语言项目 (`mixed-project`)

| 修改的文件 | 语言 | 预期推荐的测试 |
|-----------|------|---------------|
| `math_engine.cpp` | C++ | `MathServiceTests` |
| `string_processor.cpp` | C++ | `StringServiceTests`, `IntegrationTests` |
| `MathService.cs` | C# | `MathServiceTests` |
| `StringService.cs` | C# | `StringServiceTests`, `IntegrationTests` |
| `NativeInterop.cs` | C# | 所有测试 (P/Invoke 核心) |

## 🏃 快速运行

### 纯 C++ 项目

```cmd
cd tests\e2e\cpp-project
run_e2e_test.cmd
```

### 混合语言项目

```cmd
cd tests\e2e\mixed-project
run_e2e_test.cmd
```

## 代码依赖关系

### cpp-project

```
calculator.cpp
  ├── test_calculator_basic.cpp  → 测试基础四则运算
  └── test_calculator_advanced.cpp → 测试幂运算、平方根、累加器

statistics.cpp
  └── test_statistics.cpp
      └── 依赖 string_utils.cpp (formatSummary 使用 toUpperCase)

string_utils.cpp
  ├── test_string_utils.cpp  → 直接测试
  └── test_statistics.cpp    → 间接依赖
```

### mixed-project

```
┌─────────────────────────────────────────────────────────────┐
│                    C# 测试层                                │
│  MathServiceTests  │  StringServiceTests  │  IntegrationTests
├───────────┬────────┴───────────┬──────────┴────────┬────────┤
│           ▼                    ▼                   ▼        │
│     MathService           StringService       (两者结合)    │
│           │                    │                            │
│           └────────────────────┴─────────┐                 │
│                    NativeInterop (P/Invoke)                 │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    C++ 原生库                               │
│         math_engine.cpp      │      string_processor.cpp    │
└─────────────────────────────────────────────────────────────┘
```

## 前置条件

1. **Visual Studio 2022** (包含 Clang/LLVM 工具集)
   - 安装 "Desktop development with C++"
   - 安装 "C++ Clang tools for Windows"

2. **CMake 3.20+** 和 **Ninja**
   ```powershell
   choco install cmake ninja
   ```

3. **.NET SDK**（用于运行 `TiaCC.Cli`）
   ```powershell
   dotnet --info
   ```

## 运行完整 E2E 测试

### 推荐方式 (使用 cmd 脚本)

```cmd
cd tests\e2e\cpp-project
run_e2e_test.cmd
```

这个脚本会自动：
1. 设置 Visual Studio 开发环境
2. 使用 Clang 编译项目 (启用覆盖率插桩)
3. 运行所有测试并收集覆盖率
4. 处理覆盖率数据 (profraw → profdata → JSON)
5. 构建影响映射数据库
6. 验证推荐功能

### 手动步骤

如果自动化脚本不工作，请参考以下手动步骤：

#### 1. 打开 Visual Studio Developer Command Prompt

```cmd
"C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
```

#### 2. 编译项目

```cmd
cd tests\e2e\cpp-project
mkdir build && cd build

cmake .. -G "Ninja" ^
    -DCMAKE_C_COMPILER=clang ^
    -DCMAKE_CXX_COMPILER=clang++ ^
    -DCMAKE_BUILD_TYPE=Debug ^
    -DENABLE_COVERAGE=ON

cmake --build .
```

#### 3. 运行测试收集覆盖率

```cmd
mkdir ..\coverage_data

set LLVM_PROFILE_FILE=..\coverage_data\test_calculator_basic.profraw
test_calculator_basic.exe

set LLVM_PROFILE_FILE=..\coverage_data\test_calculator_advanced.profraw
test_calculator_advanced.exe

set LLVM_PROFILE_FILE=..\coverage_data\test_statistics.profraw
test_statistics.exe

set LLVM_PROFILE_FILE=..\coverage_data\test_string_utils.profraw
test_string_utils.exe
```

#### 4. 处理覆盖率数据

```cmd
cd ..\coverage_data

llvm-profdata merge -sparse test_calculator_basic.profraw -o test_calculator_basic.profdata
llvm-cov export ..\build\test_calculator_basic.exe -instr-profile=test_calculator_basic.profdata -format=text > test_calculator_basic.coverage.json

REM 对其他测试文件重复...
```

#### 5. 构建映射数据库

```cmd
cd ..\..\..\..

dotnet run --project src\cli\dotnet\TiaCC.Cli\TiaCC.Cli.csproj -c Release -- init --db tests\e2e\cpp-project\impact_map.db

dotnet run --project src\cli\dotnet\TiaCC.Cli\TiaCC.Cli.csproj -c Release -- map ^
    --db tests\e2e\cpp-project\impact_map.db ^
    --coverage tests\e2e\cpp-project\coverage_data\test_calculator_basic.coverage.json ^
    --test test_calculator_basic ^
    --base-dir .

REM 对其他测试文件重复...
```

#### 6. 验证推荐

```cmd
dotnet run --project src\cli\dotnet\TiaCC.Cli\TiaCC.Cli.csproj -c Release -- query --db tests\e2e\cpp-project\impact_map.db --files tests/e2e/cpp-project/src/calculator.cpp
REM 应该返回: test_calculator_basic, test_calculator_advanced

dotnet run --project src\cli\dotnet\TiaCC.Cli\TiaCC.Cli.csproj -c Release -- query --db tests\e2e\cpp-project\impact_map.db --files tests/e2e/cpp-project/src/statistics.cpp
REM 应该返回: test_statistics

dotnet run --project src\cli\dotnet\TiaCC.Cli\TiaCC.Cli.csproj -c Release -- query --db tests\e2e\cpp-project\impact_map.db --files tests/e2e/cpp-project/src/string_utils.cpp
REM 应该返回: test_string_utils, test_statistics
```

## 覆盖率文件格式

TiaCC 支持以下覆盖率文件格式：

| 格式 | 扩展名 | 说明 |
|------|--------|------|
| LLVM profraw | `.profraw` | 原始覆盖率数据 (需要 llvm-profdata 和 llvm-cov 处理) |
| LLVM JSON | `.coverage.json` | 预处理的 LLVM JSON 导出 (推荐) |
| Coverlet JSON | `.coverage.json` | .NET Coverlet 格式 |

## 故障排除

### Clang 找不到

确保使用 Visual Studio Developer Command Prompt，或手动设置：
```cmd
set PATH=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\Llvm\x64\bin;%PATH%
```

### profraw 文件未生成

确保编译时启用了以下标志：
```
-fprofile-instr-generate -fcoverage-mapping
```

### llvm-cov 导出失败

确保使用相同版本的 Clang 编译器和 LLVM 工具。

### 映射数据库为空

检查覆盖率 JSON 文件是否正确生成：
```cmd
dir coverage_data\*.cov.json
type coverage_data\test_calculator_basic.cov.json | find "filename"
```
