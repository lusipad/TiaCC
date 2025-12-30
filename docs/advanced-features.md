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
# 获取变更文件
CHANGED=$(git diff --name-only origin/main)

# 查询受影响的测试
dotnet run --project tools-dotnet/TiaCC.Cli -- query \
  --db impact_map.db \
  --files $CHANGED

# 输出示例:
# Affected tests:
#   test_auth_login
#   test_payment_process
#   test_cache_invalidation
```

#### 高级选项

```bash
# 显示详细统计信息
dotnet run --project tools-dotnet/TiaCC.Cli -- stats --db impact_map.db

# 查询特定文件影响的测试
dotnet run --project tools-dotnet/TiaCC.Cli -- query \
  --db impact_map.db \
  --files src/Calculator.cs src/Utils.cs

# 输出到文件供 CI 使用
dotnet run --project tools-dotnet/TiaCC.Cli -- query \
  --db impact_map.db \
  --files $CHANGED > affected_tests.txt
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

```csharp
using TiaCC.Core.Services;

// 使用 MappingService 记录测试结果
var mappingService = new MappingService(dbPath);

// 记录测试执行结果
mappingService.RecordTestResult(
    testPath: "tests/TestCalculator.cs",
    passed: true,
    durationMs: 1250,
    commitHash: "abc123",
    changedFiles: new[] { "src/Calculator.cs", "src/MathUtils.cs" }
);
```

**方式 2: 使用 CLI（计划中）**

```bash
# 注意：此功能尚未实现，计划在未来版本中提供
# dotnet run --project tools-dotnet/TiaCC.Cli -- record-test \
#   --db impact_map.db \
#   --test tests/TestCalculator.cs \
#   --status pass \
#   --duration 1250 \
#   --commit abc123
```

### 2.4 查看失败预测

```bash
# 查看数据库统计信息
dotnet run --project tools-dotnet/TiaCC.Cli -- stats --db impact_map.db

# 查询受影响的测试
CHANGED=$(git diff --name-only origin/main)
dotnet run --project tools-dotnet/TiaCC.Cli -- query \
  --db impact_map.db \
  --files $CHANGED
```

---

## 3. Flaky 测试分析

### 3.1 什么是 Flaky 测试？

Flaky 测试是指在相同代码下，有时通过、有时失败的不稳定测试。这类测试会降低 CI 可信度，浪费开发者时间。

### 3.2 识别 Flaky 测试

```bash
# 查看数据库统计
dotnet run --project tools-dotnet/TiaCC.Cli -- stats --db impact_map.db

# 输出示例:
# 📊 Database Statistics:
#   Source files: 45
#   Test scripts: 120
#   Total mappings: 892
#
# Most covered source files:
#   src/Calculator.cs (15 tests)
#   src/Database.cs (12 tests)
```

### 3.3 关联分析（计划中）

> ⚠️ **注意**：`--show-correlations` 选项尚未实现，计划在未来版本中提供

**当前可用的替代方案**：

```bash
# 查询文件覆盖的测试
dotnet run --project tools-dotnet/TiaCC.Cli -- query \
  --db impact_map.db \
  --files src/Database.cs

# 查看完整统计
dotnet run --project tools-dotnet/TiaCC.Cli -- stats --db impact_map.db
```

---

## 4. 精确测试方法推荐

### 4.1 概述

除了推荐测试文件，TiaCC 还可以精确推荐具体的测试方法（如 `TestCalculator.TestAddition`），特别适用于大型测试类。

### 4.2 使用方法

```bash
# 查询受影响的测试
CHANGED=$(git diff --name-only origin/main)
dotnet run --project tools-dotnet/TiaCC.Cli -- query \
  --db impact_map.db \
  --files $CHANGED

# 输出示例:
# Affected tests:
#   TestCalculator
#   TestStatistics
```

### 4.3 集成到测试框架

**示例: xUnit (C#)**

```bash
# 获取受影响的测试
CHANGED=$(git diff --name-only origin/main)
AFFECTED=$(dotnet run --project tools-dotnet/TiaCC.Cli -- query \
  --db impact_map.db \
  --files $CHANGED)

# 使用 dotnet test 的过滤器运行
if [ -n "$AFFECTED" ]; then
  FILTER=$(echo "$AFFECTED" | tr '\n' '|' | sed 's/|$//')
  dotnet test --filter "FullyQualifiedName~$FILTER"
else
  dotnet test
fi
```

**示例: NUnit (C#)**

```bash
# 获取受影响的测试
CHANGED=$(git diff --name-only origin/main)
AFFECTED=$(dotnet run --project tools-dotnet/TiaCC.Cli -- query \
  --db impact_map.db \
  --files $CHANGED)

# 使用 NUnit 过滤器
if [ -n "$AFFECTED" ]; then
  FILTER=$(echo "$AFFECTED" | tr '\n' '|')
  dotnet test --filter "$FILTER"
else
  dotnet test
fi
```

---

## 5. 多格式覆盖率支持

### 5.1 支持的格式列表

| 语言/生态 | 工具 | 格式 | TiaCC 支持 |
|----------|------|------|-----------|
| C/C++ | LLVM | `.profraw`, `.cov.json` | 默认支持 |
| C/C++ | gcov/lcov | `.info` | `lcov` |
| C/C++ (Windows) | OpenCppCoverage | `CoverageReport*.xml` | `opencppcoverage` |
| C#/.NET | Coverlet | `*.cobertura.xml` | 默认支持 |
| C#/.NET | dotCover | `dotcover*.xml` | `dotcover` |
| Java | JaCoCo | `jacoco*.xml` | `jacoco` |
| Python | coverage.py | `coverage*.json` | `coveragepy` |
| Lua | LuaCov | `luacov*.out` | `luacov` |
| 通用 | Cobertura | `*.cobertura.xml` | 默认支持 |

### 5.2 多语言项目示例

```bash
# 初始化数据库
dotnet run --project tools-dotnet/TiaCC.Cli -- init --db impact_map.db

# 映射覆盖率数据（自动检测格式）
dotnet run --project tools-dotnet/TiaCC.Cli -- map \
  --db impact_map.db \
  --coverage ./coverage/*.cobertura.xml \
  --test AllTests

# TiaCC 自动检测格式:
# - *.cobertura.xml → Cobertura (通用)
# - *.coverage.json → Coverlet
```

### 5.3 自定义测试 ID 提取

对于 Cobertura 格式，TiaCC 提供多种方式提取测试 ID：

```bash
# 从文件名解析
dotnet run --project tools-dotnet/TiaCC.Cli -- map \
  --db impact_map.db \
  --coverage ./coverage/TestCalculator.cobertura.xml \
  --test TestCalculator

# 批量映射多个测试
for coverage_file in ./coverage/**/coverage.cobertura.xml; do
  TEST_NAME=$(basename $(dirname "$coverage_file"))
  dotnet run --project tools-dotnet/TiaCC.Cli -- map \
    --db impact_map.db \
    --coverage "$coverage_file" \
    --test "$TEST_NAME"
done
```

---

## 6. 性能优化

### 6.1 批量处理

```bash
# 批量映射所有覆盖率文件
for coverage_file in ./coverage/**/coverage.cobertura.xml; do
  TEST_NAME=$(basename $(dirname "$coverage_file"))
  echo "Mapping coverage for $TEST_NAME..."
  dotnet run --project tools-dotnet/TiaCC.Cli -- map \
    --db impact_map.db \
    --coverage "$coverage_file" \
    --test "$TEST_NAME" || true
done
```

### 6.2 增量更新（计划中）

> ⚠️ **注意**：`--incremental` 选项尚未实现，计划在未来版本中提供

数据库已包含 `processed_files` 表支持增量更新，但 CLI 选项尚未实现。

**当前替代方案**：

```bash
# 清理旧数据后重新构建
rm -rf coverage_data/*.profraw
dotnet run --project tools-dotnet/TiaCC.Cli -- init --db impact_map.db

# 重新映射
for coverage_file in ./coverage/*.cobertura.xml; do
  dotnet run --project tools-dotnet/TiaCC.Cli -- map \
    --db impact_map.db \
    --coverage "$coverage_file" \
    --test AllTests
done
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

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Run all tests with coverage
        run: |
          dotnet test --collect:"XPlat Code Coverage" \
            --results-directory ./coverage

      - name: Build TiaCC
        run: dotnet build tools-dotnet -c Release

      - name: Build impact map
        run: |
          dotnet run --project tools-dotnet/TiaCC.Cli -- init --db impact_map.db

          for coverage_file in ./coverage/**/coverage.cobertura.xml; do
            TEST_NAME=$(basename $(dirname "$coverage_file"))
            dotnet run --project tools-dotnet/TiaCC.Cli -- map \
              --db impact_map.db \
              --coverage "$coverage_file" \
              --test "$TEST_NAME" || true
          done

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

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Download impact map
        uses: dawidd6/action-download-artifact@v3
        with:
          workflow: nightly.yml
          name: impact-map
        continue-on-error: true

      - name: Build TiaCC
        run: dotnet build tools-dotnet -c Release

      - name: Get affected tests
        id: tiacc
        run: |
          if [ -f impact_map.db ]; then
            CHANGED=$(git diff --name-only origin/main)
            AFFECTED=$(dotnet run --project tools-dotnet/TiaCC.Cli -- query \
              --db impact_map.db \
              --files $CHANGED 2>/dev/null || echo "")
            echo "affected=$AFFECTED" >> $GITHUB_OUTPUT
          fi

      - name: Run affected tests
        run: |
          if [ -n "${{ steps.tiacc.outputs.affected }}" ]; then
            FILTER=$(echo "${{ steps.tiacc.outputs.affected }}" | tr '\n' '|' | sed 's/|$//')
            dotnet test --filter "FullyQualifiedName~$FILTER"
          else
            dotnet test
          fi
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
      - uses: actions/checkout@v4

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Download impact map
        uses: dawidd6/action-download-artifact@v3
        with:
          workflow: nightly.yml
          name: impact-map

      - name: Build TiaCC
        run: dotnet build tools-dotnet -c Release

      - name: Generate stats report
        run: |
          dotnet run --project tools-dotnet/TiaCC.Cli -- stats \
            --db impact_map.db > stats_report.txt

      - name: Create issue for stats
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('stats_report.txt', 'utf8');
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '📊 Weekly TiaCC Statistics Report',
              body: '```\n' + report + '\n```'
            });
```

---

## 8. 故障排查

### 8.1 查询没有返回结果

**原因**: 数据库中没有映射数据或文件路径不匹配

**解决方案**:
```bash
# 检查数据库统计
dotnet run --project tools-dotnet/TiaCC.Cli -- stats --db impact_map.db

# 如果 source_files 表为空，需要先映射覆盖率数据
dotnet run --project tools-dotnet/TiaCC.Cli -- init --db impact_map.db
dotnet run --project tools-dotnet/TiaCC.Cli -- map \
  --db impact_map.db \
  --coverage ./coverage/*.cobertura.xml \
  --test AllTests
```

### 8.2 覆盖率数据缺失

**原因**: 覆盖率文件格式不正确或路径错误

**解决方案**:
```bash
# 检查覆盖率文件是否存在
ls -la ./coverage/*.cobertura.xml

# 检查覆盖率文件内容
head -50 ./coverage/coverage.cobertura.xml

# 确保路径正确
dotnet run --project tools-dotnet/TiaCC.Cli -- map \
  --db impact_map.db \
  --coverage "./coverage/coverage.cobertura.xml" \
  --test "AllTests"
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
- [CI/CD 集成指南](ci-cd-integration.md)
