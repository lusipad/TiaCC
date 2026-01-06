# TiaCC 混合语言端到端测试

这是一个混合语言项目，展示 TiaCC 在 C# exe + C++ native lib (P/Invoke) 场景下的测试影响分析能力。

## 项目结构

```
mixed-project/
├── native/                    # C++ 原生库
│   ├── src/
│   │   ├── math_engine.cpp    # 数学计算引擎
│   │   ├── math_engine.h
│   │   ├── string_processor.cpp
│   │   └── string_processor.h
│   ├── CMakeLists.txt
│   └── exports.def            # DLL 导出定义
├── managed/                   # C# 托管代码
│   ├── MixedApp/              # 主应用程序
│   │   ├── NativeInterop.cs   # P/Invoke 声明
│   │   ├── MathService.cs     # 调用原生库的服务
│   │   ├── StringService.cs
│   │   └── Program.cs
│   ├── MixedApp.Tests/        # 测试项目
│   │   ├── MathServiceTests.cs
│   │   ├── StringServiceTests.cs
│   │   └── IntegrationTests.cs
│   └── MixedApp.sln
├── coverage_data/             # 覆盖率输出
├── run_e2e_test.cmd           # 自动化测试脚本
└── README.md
```

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    MixedApp (C# exe)                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │   MathService   │    │  StringService  │                │
│  └────────┬────────┘    └────────┬────────┘                │
│           │                      │                          │
│           ▼                      ▼                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              NativeInterop (P/Invoke)               │   │
│  │      [DllImport("native_lib.dll")]                  │   │
│  └──────────────────────────┬──────────────────────────┘   │
│                             │                               │
└─────────────────────────────┼───────────────────────────────┘
                              │ P/Invoke
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                native_lib.dll (C++ lib)                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────────────┐        │
│  │  math_engine    │    │  string_processor       │        │
│  │  - Add          │    │  - ToUpperCase          │        │
│  │  - Multiply     │    │  - Concat               │        │
│  │  - Power        │    │  - GetLength            │        │
│  │  - Sqrt         │    │  - Contains             │        │
│  └─────────────────┘    └─────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## 覆盖率收集方式

### C++ 原生库
- 使用 Clang + LLVM Profile 进行覆盖率插桩
- 生成 `.profraw` → `.cov.json` 文件

### C# 托管代码
- 使用 Coverlet 进行覆盖率收集
- 生成 `.coverage.json` 文件

### 映射合并
- TiaCC 同时处理两种覆盖率格式
- 建立跨语言的测试影响映射

## 预期映射关系

| 修改的文件 | 语言 | 应推荐的测试 |
|-----------|------|-------------|
| `math_engine.cpp` | C++ | `MathServiceTests` |
| `string_processor.cpp` | C++ | `StringServiceTests`, `IntegrationTests` |
| `MathService.cs` | C# | `MathServiceTests` |
| `StringService.cs` | C# | `StringServiceTests`, `IntegrationTests` |
| `NativeInterop.cs` | C# | 所有测试 (核心依赖) |

## 运行方法

### 前置条件

1. **Visual Studio 2022** - C++ 和 C# 开发工具
2. **.NET 8 SDK**
3. **Clang/LLVM** (VS 2022 自带)

### 运行完整测试

```cmd
cd tests\e2e\mixed-project
run_e2e_test.cmd
```

### 分步执行

```cmd
:: 1. 编译 C++ 原生库
cd native\build
cmake .. -G "Ninja" -DCMAKE_BUILD_TYPE=Debug -DENABLE_COVERAGE=ON
cmake --build .

:: 2. 编译 C# 项目
cd ..\..\managed
dotnet build

:: 3. 运行测试并收集覆盖率
dotnet test /p:CollectCoverage=true /p:CoverletOutputFormat=json --filter "FullyQualifiedName~MathServiceTests"

:: 4. 处理 C++ 覆盖率
llvm-profdata merge -sparse *.profraw -o coverage.profdata
llvm-cov export native_lib.dll -instr-profile=coverage.profdata -format=text > cpp.coverage.json

:: 5. 构建映射
cd ..\..\..
dotnet run --project src\cli\dotnet\TiaCC.Cli\TiaCC.Cli.csproj -c Release -- init --db tests\e2e\mixed-project\impact_map.db
dotnet run --project src\cli\dotnet\TiaCC.Cli\TiaCC.Cli.csproj -c Release -- map --db tests\e2e\mixed-project\impact_map.db --coverage tests\e2e\mixed-project\coverage_data\cpp.coverage.json --test MathServiceTests --base-dir .
```

## 验证查询

```bash
# 查询 C++ 文件
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -c Release -- query --db tests/e2e/mixed-project/impact_map.db --files tests/e2e/mixed-project/native/src/math_engine.cpp

# 查询 C# 文件
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -c Release -- query --db tests/e2e/mixed-project/impact_map.db --files tests/e2e/mixed-project/managed/MixedApp/MathService.cs
```
