# TiaCC 快速集成指南

> 5 分钟快速接入 TiaCC 测试影响分析系统

## 方式一：npm 安装（推荐）

```bash
# 全局安装
npm install -g @tiacc/tools

# 或作为项目依赖
npm install @tiacc/tools --save-dev
```

## 方式二：从源码安装

```bash
git clone https://github.com/your-org/TiaCC.git
cd TiaCC/tools-node
npm install && npm run build && npm link
```

---

## 快速开始：3 步集成

### 第 1 步：生成覆盖率数据

**C++ 项目**（使用 Clang）：
```bash
# 编译时启用覆盖率
clang++ -fprofile-instr-generate -fcoverage-mapping -o myapp src/*.cpp

# 运行测试，每个测试生成 .profraw
LLVM_PROFILE_FILE="coverage/%m_%p.profraw" ./myapp --run-tests

# 转换为 JSON 格式
llvm-profdata merge coverage/*.profraw -o coverage/merged.profdata
llvm-cov export ./myapp -instr-profile=coverage/merged.profdata > coverage/data.cov.json
```

**C# 项目**：
```bash
dotnet test --collect:"XPlat Code Coverage" --results-directory ./coverage
```

### 第 2 步：构建映射数据库

```bash
tia-mapper build --coverage-dir ./coverage --db impact_map.db
```

### 第 3 步：获取受影响的测试

```bash
# 对比当前分支与 main 分支的变更
tia-recommend --db impact_map.db --branch origin/main

# 输出到文件
tia-recommend --db impact_map.db --branch origin/main --output affected_tests.txt
```

---

## 程序化调用（Node.js/TypeScript）

```typescript
import { TiaCC } from '@tiacc/tools';

// 一行代码完成初始化
const tia = await TiaCC.init('./impact_map.db');

// 构建映射（通常在 CI 的 nightly 任务中执行）
await tia.buildMapping('./coverage');

// 获取受影响的测试（通常在 PR 检查中执行）
const result = await tia.getAffectedTests({ baseBranch: 'origin/main' });

console.log('受影响的测试:', result.tests);
console.log('节省比例:', result.savingsPercent + '%');
```

---

## CI/CD 集成示例

### GitHub Actions

```yaml
# .github/workflows/pr-check.yml
name: Smart Test
on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install TiaCC
        run: npm install -g @tiacc/tools

      - name: Download impact map
        uses: dawidd6/action-download-artifact@v3
        with:
          workflow: nightly.yml
          name: impact-map

      - name: Get affected tests
        run: |
          tia-recommend --db impact_map.db --branch origin/main --output tests.txt
          echo "Running $(wc -l < tests.txt) affected tests..."

      - name: Run affected tests
        run: cat tests.txt | xargs -I {} ./run_test {}
```

### GitLab CI

```yaml
smart-test:
  stage: test
  script:
    - npm install -g @tiacc/tools
    - tia-recommend --db impact_map.db --branch origin/main --output tests.txt
    - cat tests.txt | xargs -I {} ./run_test {}
  only:
    - merge_requests
```

---

## 常用命令速查

### 基础命令

| 命令 | 说明 |
|------|------|
| `tia-mapper build` | 从覆盖率数据构建映射数据库 |
| `tia-mapper stats` | 查看数据库统计信息 |
| `tia-mapper query <file>` | 查询某文件被哪些测试覆盖 |
| `tia-mapper export` | 导出数据用于 Dashboard 可视化 |
| `tia-recommend` | 获取受影响的测试列表 |
| `tia-recommend --json` | 以 JSON 格式输出结果 |

### 高级选项

#### tia-mapper build 完整参数

```bash
tia-mapper build \
  --coverage-dir <dir>          # 覆盖率文件目录（必需）
  --db <path>                   # 数据库路径（默认: impact_map.db）
  [--executable <path>]         # C++ 可执行文件路径（用于处理 .profraw）
  [--base-path <path>]          # 基准路径，用于规范化文件路径
  [--commit <hash>]             # Git 提交哈希
  [--concurrency <num>]         # 并发处理数（默认: 4）
  [--verbose]                   # 详细输出

  # 特定格式支持
  [--test-id-from-env <var>]    # 从环境变量读取测试 ID
  [--test-id-from-source]       # 从 Cobertura XML <source> 标签读取
  [--test-id-from-filename]     # 从文件名解析测试 ID
  [--opencppcoverage]           # 启用 OpenCppCoverage 支持
  [--lcov]                      # 启用 LCOV 格式支持
  [--jacoco]                    # 启用 JaCoCo 格式支持
  [--istanbul]                  # 启用 Istanbul 格式支持
  [--coveragepy]                # 启用 coverage.py 支持
  [--dotcover]                  # 启用 dotCover 支持
  [--luacov]                    # 启用 LuaCov 支持
```

#### tia-recommend 完整参数

```bash
tia-recommend \
  --db <path>                   # 数据库路径（必需）
  [--base <ref>]                # Git 基准引用（默认: HEAD~1）
  [--branch <name>]             # 对比分支（如 origin/main）
  [--level file|function]       # 分析级别（默认: function）
  [--output <file>]             # 输出文件路径
  [--extensions <exts...>]      # 文件扩展名过滤
  [--include-untracked]         # 包含未跟踪的文件
  [--json]                      # JSON 格式输出
  [--quiet]                     # 静默模式

  # 精确推荐
  [--methods]                   # 输出测试方法而非测试文件
  [--group-by-class]            # 按类分组输出

  # 智能推荐（Phase 4）
  [--smart]                     # 启用智能推荐
  [--show-probability]          # 显示失败概率
  [--show-duration]             # 显示预计耗时
  [--top <n>]                   # 只显示前 N 个高优先级测试
  [--min-probability <p>]       # 最小失败概率过滤（0-1）
  [--flaky]                     # 分析易失败的测试
```

---

## 高级使用示例

### 支持多种覆盖率格式

```bash
# Java 项目（JaCoCo）
tia-mapper build --coverage-dir ./target/site/jacoco --jacoco --db impact_map.db

# JavaScript 项目（Istanbul/nyc）
tia-mapper build --coverage-dir ./coverage --istanbul --db impact_map.db

# Python 项目（coverage.py）
tia-mapper build --coverage-dir ./htmlcov --coveragepy --db impact_map.db

# Lua 项目（LuaCov）
tia-mapper build --coverage-dir ./luacov-html --luacov --db impact_map.db
```

### 智能推荐场景

```bash
# 场景 1: PR 快速验证 - 只运行最重要的 10 个测试
tia-recommend --db impact_map.db --smart --top 10 --branch origin/main

# 场景 2: 高风险变更检查 - 只运行失败概率 > 30% 的测试
tia-recommend --db impact_map.db --smart --min-probability 0.3

# 场景 3: 定期质量分析 - 找出易失败的测试
tia-recommend --db impact_map.db --flaky

# 场景 4: 大规模重构 - 精确到测试方法级别
tia-recommend --db impact_map.db --level function --methods --group-by-class
```

### 并发处理大量覆盖率文件

```bash
# 使用 8 个并发 worker 加速处理
tia-mapper build \
  --coverage-dir ./coverage \
  --db impact_map.db \
  --concurrency 8 \
  --verbose
```

---

## 下一步

- 📖 [完整文档](docs/architecture.md)
- 🔧 [详细集成指南](docs/integration-guide.md)
- 📊 [Dashboard 使用](dashboard/README.md)
- 🧪 [E2E 测试示例](tests/e2e/README.md)
- 🎯 [智能推荐高级功能](docs/advanced-features.md)

---

## 获取帮助

```bash
tia-mapper --help
tia-recommend --help
```

有问题？请提交 [Issue](https://github.com/your-org/TiaCC/issues)
