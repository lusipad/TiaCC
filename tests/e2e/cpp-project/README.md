# TiaCC C++ 端到端验证项目

这是一个完整的 C++ 项目，用于真实验证 TiaCC 系统的完整工作流程。

## 项目结构

```
cpp-project/
├── src/
│   ├── calculator.cpp     # 计算器模块
│   ├── calculator.h
│   ├── statistics.cpp     # 统计模块
│   ├── statistics.h
│   ├── string_utils.cpp   # 字符串工具
│   └── string_utils.h
├── tests/
│   ├── test_calculator_basic.cpp    # 基础计算器测试
│   ├── test_calculator_advanced.cpp # 高级计算器测试
│   ├── test_statistics.cpp          # 统计测试
│   └── test_string_utils.cpp        # 字符串工具测试
├── CMakeLists.txt
└── run_e2e_test.ps1       # 完整 E2E 验证脚本
```

## 验证流程

1. **编译**: 使用 Clang 编译并启用 `-fprofile-instr-generate -fcoverage-mapping`
2. **运行测试**: 分别运行每个测试，生成独立的 `.profraw` 文件
3. **处理覆盖率**: 使用 `llvm-profdata` 和 `llvm-cov` 处理覆盖率数据
4. **构建映射**: 使用 `tia-mapper` 构建源文件→测试的映射数据库
5. **验证推荐**: 模拟代码变更，验证 `tia-recommend` 的推荐结果

## 运行方法

```powershell
# 完整端到端测试
.\run_e2e_test.ps1

# 仅编译
.\run_e2e_test.ps1 -Step Build

# 仅运行测试收集覆盖率
.\run_e2e_test.ps1 -Step Test

# 构建映射并验证
.\run_e2e_test.ps1 -Step Verify
```

## 预期结果

| 修改的文件 | 应推荐的测试 |
|-----------|-------------|
| calculator.cpp | test_calculator_basic, test_calculator_advanced |
| statistics.cpp | test_statistics |
| string_utils.cpp | test_string_utils, test_statistics |

## 依赖

- Clang 14+ with Profile Runtime
- LLVM tools (llvm-profdata, llvm-cov)
- .NET SDK (用于运行 `src/cli/dotnet/TiaCC.Cli`)
