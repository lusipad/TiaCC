# TiaCC - 测试影响分析系统

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)

### 🎯 只运行受影响的测试，让 CI 快如闪电

**将 30 分钟的全量测试缩短到 5 分钟**

[🚀 快速开始](#-快速开始) •
[📖 工作原理](#-工作原理) •
[📊 Dashboard](#-交互式-dashboard) •
[📚 文档](docs/architecture.md)

[🇬🇧 English Version](README.en.md)

</div>

---

## 😫 你是否遇到过这些问题？

| 痛点 | 描述 |
|------|------|
| ⏰ **CI 太慢** | 每次提交都要等 30+ 分钟跑完全量测试 |
| 💸 **资源浪费** | 改了一行代码，却要运行几千个不相关的测试 |
| 😴 **反馈慢** | 提交 PR 后喝完咖啡回来还没跑完 |
| 🔄 **重复劳动** | 本地测试通过，CI 又要全部重跑一遍 |

## ✨ TiaCC 如何解决？

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
│     😴                                  ✅ 3 分钟搞定！                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

</div>

### 🔍 核心原理

TiaCC 通过**代码覆盖率分析**建立源文件与测试的映射关系：

```
1️⃣ Nightly 构建时：运行全量测试，记录每个测试覆盖了哪些源文件
                   ↓
2️⃣ 生成映射数据库：calculator.cpp ← test_calc_basic, test_calc_advanced
                   statistics.cpp  ← test_statistics
                   ↓
3️⃣ PR 提交时：检测你改了哪些文件
                   ↓
4️⃣ 智能推荐：只运行受影响的测试！
```

## 📊 交互式 Dashboard

TiaCC 提供美观的 Web Dashboard，让你**可视化**理解代码与测试的关系：

### 🌐 依赖关系图

直观展示源文件（蓝色）与测试（绿色）的关联：

<div align="center">
<img src="docs/images/dashboard_main.png" alt="Dashboard 主视图" width="800">
</div>

### 📁 智能文件管理

按文件夹分组，显示聚合覆盖率，一目了然：

<div align="center">
<img src="docs/images/dashboard_folders.png" alt="文件夹视图" width="800">
</div>

### 🔬 函数级分析

点击任意源文件，查看函数级覆盖详情：

<div align="center">
<img src="docs/images/dashboard_detail.png" alt="详情面板" width="800">
</div>

## 🚀 快速开始

### 30 秒体验 Dashboard

```bash
# 1. 克隆仓库
git clone https://github.com/your-org/TiaCC.git
cd TiaCC

# 2. 启动 Dashboard（使用示例数据）
cd dashboard
python -m http.server 8080

# 3. 打开浏览器访问
# http://localhost:8080/dashboard/
```

### 在你的项目中使用

#### 第一步：Nightly 构建映射数据库

```bash
# 1. 用 Clang 编译（启用覆盖率）
clang++ -fprofile-instr-generate -fcoverage-mapping -o app src/*.cpp

# 2. 运行全量测试（每个测试生成 .profraw 文件）
./run_all_tests.sh

# 3. 构建映射数据库
cd tools-node && npm install
npx tsx src/cli/mapper.ts build \
  --coverage-dir ../coverage_data \
  --db ../impact_map.db
```

#### 第二步：PR 时获取推荐测试

```bash
# 获取受影响的测试
npx tsx src/cli/recommend.ts \
  --db impact_map.db \
  --branch origin/main

# 输出示例：
# 检测到变更文件: calculator.cpp
# 推荐测试:
#   ✓ test_calculator_basic
#   ✓ test_calculator_advanced
# 
# 节省了 998 个测试！
```

## 📈 效果对比

| 指标 | 传统方式 | 使用 TiaCC |
|------|---------|-----------|
| CI 时间 | 30 分钟 | **3-5 分钟** |
| 运行测试数 | 1000+ | **2-10 个** |
| 开发反馈 | 提交后 30 分钟 | **提交后 3 分钟** |
| 计算资源 | 100% | **5-10%** |

## 🎯 典型使用场景

### 场景 1：日常开发

```bash
# 修改了 calculator.cpp
git diff --name-only
# → src/calculator.cpp

# 查询受影响的测试
npx tsx src/cli/mapper.ts query calculator.cpp --db impact_map.db
# → test_calculator_basic, test_calculator_advanced

# 只运行这 2 个测试
./run_test test_calculator_basic test_calculator_advanced
```

### 场景 2：CI/CD 集成

```yaml
# .github/workflows/pr.yml
- name: 获取受影响的测试
  run: |
    npx tsx tools-node/src/cli/recommend.ts \
      --db impact_map.db \
      --output affected_tests.txt
    
- name: 运行受影响的测试
  run: cat affected_tests.txt | xargs ./run_test
```

### 场景 3：Dashboard 分析

1. **可视化探索** - 理解代码与测试的依赖关系
2. **函数级定位** - 找出覆盖率低的函数
3. **影响分析** - 修改某文件会影响哪些测试

## 🏗️ 支持的技术栈

| 类型 | 支持 |
|------|------|
| **语言** | C++ (LLVM), C# (Coverlet) |
| **测试框架** | Lua, Python, C#, TypeScript, Go |
| **平台** | Windows, Linux, macOS |
| **分析级别** | 文件级、函数级 |

## 📁 项目结构

```
TiaCC/
├── dashboard/           # 📊 Web 可视化 Dashboard
├── tools-node/          # 🛠️ CLI 工具 (mapper, recommend)
├── clients/             # 🔌 多语言测试框架客户端
├── src/
│   ├── cpp/             # C++ 覆盖率采集
│   └── dotnet/          # C# 覆盖率采集
├── tests/e2e/           # ✅ 端到端验证测试
└── docs/                # 📚 详细文档
```

## 🐕 Dogfooding: TiaCC 测试 TiaCC

**我们用 TiaCC 来测试 TiaCC 自己！**

TiaCC 项目本身就使用自己的工具来优化 CI/CD 流程。这不仅验证了工具的实用性，也为用户提供了真实的集成案例。

```bash
# 快速体验 TiaCC dogfooding
cd tools-node
bash scripts/build-self-test-map.sh
```

查看完整的 dogfooding 文档：[tools-node/docs/DOGFOODING.md](tools-node/docs/DOGFOODING.md)

## 📚 更多文档

| 文档 | 描述 |
|------|------|
| [架构设计](docs/architecture.md) | 系统架构、数据流、Dashboard 功能详解 |
| [集成指南](docs/integration-guide.md) | 如何集成到你的项目 |
| [Dogfooding 案例](tools-node/docs/DOGFOODING.md) | 🐕 如何用 TiaCC 测试 TiaCC 自己 |
| [E2E 测试](tests/e2e/README.md) | 端到端验证测试说明 |

## 🤝 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何参与。

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)

---

<div align="center">

**⭐ 如果 TiaCC 帮助了你，请给个 Star！**

Made with ❤️ by the TiaCC Team

</div>
