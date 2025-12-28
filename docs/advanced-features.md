# TiaCC 高级功能指南

本文档介绍 TiaCC 的高级功能，包括智能推荐、失败预测、精确测试方法推荐等。

---

## 1. 智能推荐 (Smart Recommendation)

### 1.1 概述

智能推荐功能通过结合**代码覆盖率**、**测试历史数据**和**失败预测算法**，不仅能告诉你"需要运行哪些测试"，还能告诉你"应该优先运行哪些测试"以及"哪些测试最可能失败"。

### 1.2 核心特性

| 特性 | 说明 | 适用场景 |
|------|------|---------|
| **优先级评分** | 综合覆盖率、失败概率、执行时间等因素计算测试优先级 | PR 快速验证，时间有限时只运行最重要的测试 |
| **失败预测** | 基于历史数据预测测试失败概率 | 高风险变更检查，优先运行易失败的测试 |
| **Flaky 测试分析** | 识别不稳定的测试（时而通过时而失败） | 定期质量分析，提升测试稳定性 |
| **执行时间估算** | 显示每个测试的预计执行时间 | 优化 CI 资源分配 |

### 1.3 使用方法

#### 基础智能推荐

```bash
# 启用智能推荐
tia-recommend --db impact_map.db --smart --branch origin/main

# 输出示例:
# 🎯 Smart Test Recommendations
#
# High Priority Tests (3):
#   1. test_auth_login         [Priority: 0.92, Fail: 45%, ~2.5s]
#   2. test_payment_process    [Priority: 0.85, Fail: 38%, ~5.1s]
#   3. test_cache_invalidation [Priority: 0.78, Fail: 12%, ~1.2s]
#
# Medium Priority Tests (5):
#   4. test_user_registration  [Priority: 0.65, Fail: 5%, ~1.8s]
#   ...
#
# Recommendation: Run top 3 high-priority tests first
# Total estimated time: ~10.8s (vs. 45.2s for all tests)
```

#### 高级选项

```bash
# 只显示优先级最高的 10 个测试
tia-recommend --db impact_map.db --smart --top 10

# 只运行失败概率 >= 30% 的测试
tia-recommend --db impact_map.db --smart --min-probability 0.3

# 显示详细的失败概率和执行时间
tia-recommend --db impact_map.db --smart --show-probability --show-duration

# 输出到文件供 CI 使用
tia-recommend --db impact_map.db --smart --top 20 --output affected_tests.txt
```

### 1.4 优先级评分算法

智能推荐使用多维度评分模型：

```
priority_score = w1 * coverage_score
               + w2 * failure_probability
               + w3 * recency_score
               + w4 * (1 / execution_time_factor)

参数说明:
- coverage_score: 覆盖率评分 (0-1)，该测试覆盖变更代码的程度
- failure_probability: 失败概率 (0-1)，基于历史失败率计算
- recency_score: 最近失败的时间衰减分数，最近失败的测试优先级更高
- execution_time_factor: 执行时间因子，快速测试优先级更高
- w1, w2, w3, w4: 权重参数（可配置）
```

**默认权重配置**：
- `w1 = 0.4` - 覆盖率最重要
- `w2 = 0.3` - 失败概率次之
- `w3 = 0.2` - 最近失败情况
- `w4 = 0.1` - 执行时间

---

## 2. 失败预测

### 2.1 原理

TiaCC 通过分析测试执行历史，预测每个测试在当前变更下失败的概率。

**预测因素**：
1. **历史失败率** - 该测试在过去 N 次运行中的失败比例
2. **失败连续性** - 连续失败的次数，连续失败越多，再次失败概率越高
3. **文件关联性** - 特定文件变更导致该测试失败的历史关联度

### 2.2 数据来源

失败预测依赖以下数据库表：

```sql
-- 测试执行历史
test_history (test_script_id, run_date, passed, duration_ms, commit_hash, changed_files)

-- 测试统计聚合
test_stats (test_script_id, total_runs, total_failures, recent_failure_rate, failure_streak)

-- 文件变更与失败的关联
failure_correlations (source_file_id, test_script_id, correlation_score, failure_count)
```

### 2.3 记录测试结果

要启用失败预测，需要在 CI 中记录测试执行结果：

**方式 1: 使用 API**

```typescript
import { TiaCC } from '@tiacc/tools';

const tia = await TiaCC.init('./impact_map.db');

// 测试执行后记录结果
await tia.recordTestResult({
  testPath: 'tests/test_calculator.cpp',
  passed: true,
  durationMs: 1250,
  commitHash: await git.getCurrentCommitHash(),
  changedFiles: ['src/calculator.cpp', 'src/math_utils.cpp']
});
```

**方式 2: 使用 CLI（待实现）**

```bash
# 记录测试结果
tia-mapper record-test \
  --db impact_map.db \
  --test tests/test_calculator.cpp \
  --status pass \
  --duration 1250 \
  --commit abc123
```

### 2.4 查看失败预测

```bash
# 查看所有受影响测试的失败预测
tia-recommend --db impact_map.db --smart --show-probability

# 只显示高风险测试
tia-recommend --db impact_map.db --smart --min-probability 0.3
```

---

## 3. Flaky 测试分析

### 3.1 什么是 Flaky 测试？

Flaky 测试是指在相同代码下，有时通过、有时失败的不稳定测试。这类测试会降低 CI 可信度，浪费开发者时间。

### 3.2 识别 Flaky 测试

```bash
tia-recommend --db impact_map.db --flaky

# 输出示例:
# 🔍 Flaky Test Analysis
#
# Most Flaky Tests (Top 10):
#   1. test_concurrent_access      [Fail Rate: 68%, Streak: 5, Runs: 42]
#      → Likely cause: Race condition or timing issue
#
#   2. test_network_timeout        [Fail Rate: 52%, Streak: 3, Runs: 89]
#      → Likely cause: External dependency or network instability
#
#   3. test_database_transaction   [Fail Rate: 43%, Streak: 2, Runs: 31]
#      → Likely cause: Database state not properly reset
#
# Recommendation:
#   - Fix flaky tests with >50% failure rate immediately
#   - Consider quarantining tests with >3 consecutive failures
#   - Review tests failing on specific files (shown below)
```

### 3.3 关联分析

```bash
# 查看特定文件变更时哪些测试最易失败
tia-mapper query src/database.cpp --db impact_map.db --show-correlations

# 输出示例:
# Tests covering src/database.cpp:
#   1. test_transaction_commit     [Coverage: 85%, Failures: 12/50, Correlation: 0.78]
#   2. test_connection_pool        [Coverage: 62%, Failures: 5/50, Correlation: 0.45]
#   3. test_query_builder          [Coverage: 91%, Failures: 2/50, Correlation: 0.12]
#
# High correlation (>0.7) indicates this file change frequently causes test failure
```

---

## 4. 精确测试方法推荐

### 4.1 概述

除了推荐测试文件，TiaCC 还可以精确推荐具体的测试方法（如 `TestCalculator::testAddition`），特别适用于大型测试类。

### 4.2 使用方法

```bash
# 输出测试方法而非测试文件
tia-recommend --db impact_map.db --level function --methods

# 输出示例:
# 📋 Recommended Test Methods
#
# TestCalculator::testAddition
# TestCalculator::testSubtraction
# TestStatistics::testMean
# TestStatistics::testStdDev
#
# Total: 4 test methods (vs. 2 test files)
```

### 4.3 按类分组

```bash
tia-recommend --db impact_map.db --methods --group-by-class

# 输出示例:
# 📋 Recommended Test Methods (Grouped by Class)
#
# TestCalculator (2 methods):
#   - testAddition
#   - testSubtraction
#
# TestStatistics (2 methods):
#   - testMean
#   - testStdDev
#
# Total: 2 test classes, 4 test methods
```

### 4.4 集成到测试框架

**示例: xUnit (C#)**

```bash
# 生成测试方法列表
tia-recommend --db impact_map.db --methods --quiet > test_methods.txt

# 使用 dotnet test 的过滤器运行
while IFS= read -r method; do
  dotnet test --filter "FullyQualifiedName~$method"
done < test_methods.txt
```

**示例: JUnit (Java)**

```bash
# 生成测试方法列表（格式: ClassName#methodName）
tia-recommend --db impact_map.db --methods --quiet --format junit > test_methods.txt

# 使用 JUnit ConsoleLauncher 运行
java -jar junit-platform-console-standalone.jar \
  --select-method-file test_methods.txt
```

---

## 5. 多格式覆盖率支持

### 5.1 支持的格式列表

| 语言/生态 | 工具 | 格式 | TiaCC 选项 |
|----------|------|------|-----------|
| C/C++ | LLVM | `.profraw`, `.cov.json` | 默认支持 |
| C/C++ | gcov/lcov | `.info` | `--lcov` |
| C/C++ (Windows) | OpenCppCoverage | `CoverageReport*.xml` | `--opencppcoverage` |
| C#/.NET | Coverlet | `.coverage.json` | 默认支持 |
| C#/.NET | dotCover | `dotcover*.xml` | `--dotcover` |
| Java | JaCoCo | `jacoco*.xml` | `--jacoco` |
| JavaScript/TypeScript | Istanbul/nyc | `coverage*.json` | `--istanbul` |
| Python | coverage.py | `coverage*.json` | `--coveragepy` |
| Lua | LuaCov | `luacov*.out` | `--luacov` |
| 通用 | Cobertura | `*.cobertura.xml` | 默认支持 |

### 5.2 多语言项目示例

```bash
# 混合 C++ 和 C# 项目
tia-mapper build \
  --coverage-dir ./coverage \
  --db impact_map.db \
  --verbose

# TiaCC 自动检测格式:
# - *.cov.json → LLVM
# - *.coverage.json → Coverlet
# - *.cobertura.xml → Cobertura (通用)
```

### 5.3 自定义测试 ID 提取

对于 Cobertura 格式，TiaCC 提供多种方式提取测试 ID：

```bash
# 从环境变量读取（适用于 CI）
export TEST_ID="TestCalculator_testAddition"
tia-mapper build --coverage-dir ./coverage --test-id-from-env TEST_ID

# 从 Cobertura XML 的 <source> 标签读取
tia-mapper build --coverage-dir ./coverage --test-id-from-source

# 从文件名解析（格式: Test_ClassName__test_methodName.cobertura.xml）
tia-mapper build --coverage-dir ./coverage --test-id-from-filename
```

---

## 6. 性能优化

### 6.1 并发处理

```bash
# 使用 8 个 worker 并发处理覆盖率文件
tia-mapper build \
  --coverage-dir ./coverage \
  --db impact_map.db \
  --concurrency 8
```

**性能对比**：
- 串行处理（concurrency=1）: 100 个文件 → 120 秒
- 并发处理（concurrency=4）: 100 个文件 → 35 秒
- 并发处理（concurrency=8）: 100 个文件 → 20 秒

### 6.2 增量更新（待实现）

```bash
# 只处理新增或修改的覆盖率文件
tia-mapper build \
  --coverage-dir ./coverage \
  --db impact_map.db \
  --incremental

# TiaCC 会检查 processed_files 表，跳过已处理的文件
```

---

## 7. CI/CD 集成最佳实践

### 7.1 Nightly 构建

```yaml
# .github/workflows/nightly.yml
name: Nightly Mapping
on:
  schedule:
    - cron: '0 2 * * *'  # 每天凌晨 2 点

jobs:
  build-map:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run all tests with coverage
        run: ./run_all_tests_with_coverage.sh

      - name: Build impact map
        run: |
          npm install -g @tiacc/tools
          tia-mapper build \
            --coverage-dir ./coverage \
            --db impact_map.db \
            --commit ${{ github.sha }} \
            --verbose

      - name: Upload impact map
        uses: actions/upload-artifact@v4
        with:
          name: impact-map
          path: impact_map.db
```

### 7.2 PR 检查（智能推荐）

```yaml
# .github/workflows/pr.yml
name: PR Check
on: pull_request

jobs:
  smart-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Download impact map
        uses: dawidd6/action-download-artifact@v3
        with:
          workflow: nightly.yml
          name: impact-map

      - name: Smart test recommendation
        run: |
          npm install -g @tiacc/tools
          tia-recommend \
            --db impact_map.db \
            --smart \
            --top 20 \
            --branch origin/main \
            --output affected_tests.txt \
            --show-probability \
            --show-duration

      - name: Run recommended tests
        run: |
          cat affected_tests.txt | xargs -I {} ./run_test {}
```

### 7.3 定期质量报告

```yaml
# .github/workflows/weekly-quality.yml
name: Weekly Quality Report
on:
  schedule:
    - cron: '0 10 * * 1'  # 每周一上午 10 点

jobs:
  quality-report:
    runs-on: ubuntu-latest
    steps:
      - name: Download impact map
        uses: dawidd6/action-download-artifact@v3
        with:
          workflow: nightly.yml
          name: impact-map

      - name: Analyze flaky tests
        run: |
          npm install -g @tiacc/tools
          tia-recommend --db impact_map.db --flaky > flaky_report.txt

      - name: Create issue for flaky tests
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('flaky_report.txt', 'utf8');
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '📊 Weekly Flaky Test Report',
              body: '```\n' + report + '\n```'
            });
```

---

## 8. 故障排查

### 8.1 智能推荐没有显示失败概率

**原因**: 数据库中没有历史测试数据

**解决方案**:
```bash
# 检查是否有历史数据
tia-mapper stats --db impact_map.db

# 如果 test_history 表为空，需要先记录测试结果
# 参考第 2.3 节"记录测试结果"
```

### 8.2 优先级分数全部为 0

**原因**: 覆盖率数据缺失或没有代码变更

**解决方案**:
```bash
# 检查是否有代码变更
git diff --name-only origin/main

# 检查覆盖率映射
tia-mapper query <changed-file> --db impact_map.db
```

---

## 9. 未来计划

### Phase 5: 机器学习预测
- 使用 ML 模型预测测试失败
- 基于代码复杂度、变更大小等特征

### Phase 6: 测试并行化建议
- 分析测试依赖关系
- 建议最优的并行执行策略

### Phase 7: 成本优化
- 计算每个测试的 CI 成本
- 优化资源分配

---

## 参考资料

- [架构设计文档](architecture.md)
- [集成指南](integration-guide.md)
- [API 文档](../tools-node/README.md)
