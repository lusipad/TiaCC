# TiaCC - 测试影响分析系统

<div align="center">

[![Self Test](https://github.com/lusipad/TiaCC/actions/workflows/tiacc-self-test.yml/badge.svg?branch=main)](https://github.com/lusipad/TiaCC/actions/workflows/tiacc-self-test.yml)
[![Publish](https://github.com/lusipad/TiaCC/actions/workflows/publish.yml/badge.svg?branch=main)](https://github.com/lusipad/TiaCC/actions/workflows/publish.yml)
[![Release](https://img.shields.io/github/v/release/lusipad/TiaCC)](https://github.com/lusipad/TiaCC/releases)
[![License](https://img.shields.io/github/license/lusipad/TiaCC)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)

### 只运行受影响的测试，让 CI 快如闪电

**将 30 分钟的全量测试缩短到 5 分钟**

[快速开始](#-快速开始) |
[工作原理](#-工作原理) |
[Dashboard](#-交互式-dashboard) |
[文档](docs/architecture.zh.md)

[English](README.md)

</div>

---

## 你是否遇到过这些问题？

| 痛点 | 描述 |
|------|------|
| **CI 太慢** | 每次提交都要等 30+ 分钟跑完全量测试 |
| **资源浪费** | 改了一行代码，却要运行几千个不相关的测试 |
| **反馈慢** | 提交 PR 后喝完咖啡回来还没跑完 |
| **重复劳动** | 本地测试通过，CI 又要全部重跑一遍 |

## TiaCC 如何解决？

<div align="center">

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│     传统方式                           TiaCC 方式                        │
│     ─────────                          ──────────                        │
│                                                                         │
│     改了 calculator.cpp                改了 calculator.cpp              │
│            ↓                                  ↓                         │
│     运行 1000+ 个测试                   智能分析：该文件被哪些测试覆盖？    │
│            ↓                                  ↓                         │
│     等待 30 分钟                        只推荐 2 个相关测试               │
│            ↓                                  ↓                         │
│     ...                                 3 分钟搞定！                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

</div>

### 核心原理

TiaCC 通过**代码覆盖率分析**建立源文件与测试的映射关系：

```
1. Nightly 构建时：运行全量测试，记录每个测试覆盖了哪些源文件
                   ↓
2. 生成映射数据库：calculator.cpp ← test_calc_basic, test_calc_advanced
                   statistics.cpp  ← test_statistics
                   ↓
3. PR 提交时：检测你改了哪些文件
                   ↓
4. 智能推荐：只运行受影响的测试！
```

## 交互式 Dashboard

TiaCC 提供美观的 Web Dashboard，让你**可视化**理解代码与测试的关系：

- 依赖关系图：展示源文件与测试的关联
- 文件树/覆盖率聚合：按目录聚合覆盖率，快速定位热点
- 搜索与函数级定位：定位关键依赖与覆盖率薄弱区域
- 详细说明见 `docs/dashboard.md`

## 快速开始

### 30 秒体验 Dashboard

```bash
# 1. 克隆仓库
git clone https://github.com/lusipad/TiaCC.git
cd TiaCC

# 2. 启动 Dashboard（Blazor）
dotnet run --project src/dashboard/dotnet/TiaCC.Dashboard/TiaCC.Dashboard.csproj -c Release
```

### 在你的项目中使用

#### 第一步：安装 TiaCC CLI

```bash
# 确保已安装 .NET 10 SDK（版本见 global.json）
dotnet --version

# 构建 TiaCC CLI
dotnet build src/TiaCC.DotNet.sln -c Release
```

#### 第二步：Nightly 构建映射数据库

```bash
# 1. 运行测试并收集覆盖率
dotnet test --collect:"XPlat Code Coverage" --results-directory ./coverage

# 2. 初始化数据库
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- init --db impact_map.db

# 3. 映射覆盖率数据
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- map \
  --db impact_map.db \
  --coverage ./coverage/*/coverage.cobertura.xml \
  --test MyTestClass
```

#### 第三步：PR 时获取推荐测试

```bash
# 查询受影响的测试
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
  --db impact_map.db \
  --files src/MyService.cs

# 输出示例：
# Affected tests:
#   - MyServiceTests
#   - IntegrationTests
```

## 效果对比

| 指标 | 传统方式 | 使用 TiaCC |
|------|---------|-----------|
| CI 时间 | 30 分钟 | **3-5 分钟** |
| 运行测试数 | 1000+ | **2-10 个** |
| 开发反馈 | 提交后 30 分钟 | **提交后 3 分钟** |
| 计算资源 | 100% | **5-10%** |

## 典型使用场景

### 场景 1：日常开发

```bash
# 修改了 MathService.cs
git diff --name-only
# → src/MathService.cs

# 查询受影响的测试
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
  --db impact_map.db \
  --files src/MathService.cs
# → MathServiceTests

# 只运行这个测试
dotnet test --filter "FullyQualifiedName~MathServiceTests"
```

### 场景 2：CI/CD 集成

```yaml
# .github/workflows/pr.yml
- name: 获取受影响的测试
  run: |
    dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
      --db impact_map.db \
      --files $(git diff --name-only origin/main) \
      > affected_tests.txt

- name: 运行受影响的测试
  run: |
    FILTER=$(cat affected_tests.txt | tr '\n' '|' | sed 's/|$//')
    dotnet test --filter "FullyQualifiedName~$FILTER"
```

### 场景 3：Dashboard 分析

1. **可视化探索** - 理解代码与测试的依赖关系
2. **函数级定位** - 找出覆盖率低的函数
3. **影响分析** - 修改某文件会影响哪些测试

## 支持的技术栈

| 类型 | 支持 |
|------|------|
| **语言** | C++ (LLVM), C# (Coverlet/.NET), Java (JaCoCo), Python (coverage.py), Lua (LuaCov) |
| **覆盖率格式** | LLVM Profile, Coverlet, Cobertura, OpenCppCoverage, LCOV/gcov, JaCoCo, dotCover, LuaCov |
| **测试框架** | xUnit, NUnit, MSTest, pytest, go test, busted 等 |
| **平台** | Windows, Linux, macOS |
| **分析级别** | 文件级、函数级 |

## 项目结构

```
TiaCC/
├── global.json          # .NET SDK 版本
├── scripts/             # 仓库脚本（含 dotnet 自测脚本）
├── src/
│   ├── cli/dotnet/      # .NET CLI (tia-mapper)
│   ├── core/cpp/        # C++ 核心/覆盖率采集
│   ├── core/dotnet/     # .NET 核心库
│   ├── dashboard/dotnet/# Blazor Dashboard
│   ├── collectors/      # 覆盖率采集器（如 coverlet）
│   └── clients/         # 多语言测试框架客户端
├── tests/e2e/           # 端到端验证测试
└── docs/                # 详细文档
```

## 更多文档

| 文档 | 描述 |
|------|------|
| [架构设计](docs/architecture.zh.md) | 系统架构、数据流、Dashboard 功能详解 |
| [集成指南](docs/integration-guide.md) | 如何集成到你的项目 |
| [E2E 测试](tests/e2e/README.zh.md) | 端到端验证测试说明 |

## 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何参与。

## 许可证

MIT License - 详见 [LICENSE](LICENSE)

---

<div align="center">

**如果 TiaCC 帮助了你，请给个 Star！**

Made with by the TiaCC Team

</div>
