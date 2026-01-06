# TiaCC 多语言集成示例

> 本文档提供各种语言和框架的完整集成示例。
>
> 📖 快速入门请参考：[QUICK_START.md](../QUICK_START.md)

TiaCC 是一个通用的测试影响分析工具，可以集成到**任何项目**中。

---

## 📋 前置条件

1. 项目有自动化测试
2. 测试框架能生成覆盖率报告
3. 安装 .NET 8.0 SDK
4. 支持的覆盖率格式之一：
   - Cobertura XML (通用)
   - LCOV (C++/Go)
   - JaCoCo (Java)
   - coverage.py (Python)
   - Coverlet (C#/.NET)

---

## 🎯 场景 1: .NET/C# 项目

### 项目结构
```
my-project/
├── src/
│   ├── Utils.cs
│   └── Calculator.cs
├── tests/
│   ├── UtilsTests.cs
│   └── CalculatorTests.cs
├── MyProject.sln
└── impact_map.db
```

### 步骤

#### 1️⃣ 安装 Coverlet

```bash
dotnet add tests/MyProject.Tests package coverlet.collector
```

#### 2️⃣ 运行测试并生成覆盖率

```bash
dotnet test \
  --collect:"XPlat Code Coverage" \
  --results-directory ./coverage \
  -- DataCollectionRunSettings.DataCollectors.DataCollector.Configuration.Format=cobertura
```

#### 3️⃣ 构建 TiaCC 并初始化数据库

```bash
# 克隆 TiaCC（如果还没有）
git clone https://github.com/your-org/TiaCC.git

# 构建 TiaCC CLI
cd TiaCC
dotnet build -c Release

# 初始化数据库
dotnet run --project TiaCC.Cli -- init --db ../../impact_map.db
```

#### 4️⃣ 映射覆盖率数据

```bash
# 映射覆盖率到测试
for coverage_file in ./coverage/**/coverage.cobertura.xml; do
  TEST_NAME=$(basename $(dirname "$coverage_file"))
  dotnet run --project TiaCC.Cli -- map \
    --db ../../impact_map.db \
    --coverage "$coverage_file" \
    --test "$TEST_NAME"
done
```

#### 5️⃣ PR 时获取受影响的测试

```bash
# 检测变更的文件
CHANGED=$(git diff --name-only origin/main)

# 获取受影响的测试
AFFECTED=$(dotnet run --project TiaCC.Cli -- query \
  --db ../../impact_map.db \
  --files $CHANGED)

# 运行受影响的测试
if [ -n "$AFFECTED" ]; then
  FILTER=$(echo "$AFFECTED" | tr '\n' '|' | sed 's/|$//')
  dotnet test --filter "FullyQualifiedName~$FILTER"
else
  dotnet test
fi
```

---

## 🎯 场景 2: Python 项目

### 项目结构
```
my-project/
├── src/
│   ├── utils.py
│   └── calculator.py
├── tests/
│   ├── test_utils.py
│   └── test_calculator.py
└── pyproject.toml
```

### 步骤

#### 1️⃣ 安装 coverage.py

```bash
pip install coverage
```

#### 2️⃣ 配置 coverage.py 生成 Cobertura

创建 `.coveragerc`:
```ini
[run]
source = src

[xml]
output = coverage/cobertura-coverage.xml
```

#### 3️⃣ 运行测试并生成覆盖率

```bash
# 运行所有测试
coverage run -m pytest
coverage xml -o coverage/cobertura-coverage.xml
```

#### 4️⃣ 构建映射数据库

```bash
# 构建 TiaCC CLI
cd TiaCC
dotnet build -c Release

# 初始化并映射
dotnet run --project TiaCC.Cli -- init --db ../../impact_map.db
dotnet run --project TiaCC.Cli -- map \
  --db ../../impact_map.db \
  --coverage ../../coverage/cobertura-coverage.xml \
  --test AllTests
```

#### 5️⃣ 获取受影响的测试

```bash
CHANGED=$(git diff --name-only origin/main)
dotnet run --project TiaCC.Cli -- query \
  --db ../../impact_map.db \
  --files $CHANGED
```

---

## 🎯 场景 3: C++ 项目

### 项目结构
```
my-project/
├── src/
│   ├── utils.cpp
│   └── calculator.cpp
├── tests/
│   ├── test_utils.cpp
│   └── test_calculator.cpp
└── CMakeLists.txt
```

### 步骤

#### 1️⃣ 编译时启用覆盖率

```bash
# 使用 Clang
clang++ -fprofile-instr-generate -fcoverage-mapping \
  -o my_app src/*.cpp

# 或使用 GCC (gcov)
g++ -fprofile-arcs -ftest-coverage -o my_app src/*.cpp
```

#### 2️⃣ 运行测试生成覆盖率

**LLVM/Clang**:
```bash
# 运行测试 (每个测试生成 .profraw)
./test_utils  # 生成 test_utils.profraw
./test_calculator  # 生成 test_calculator.profraw

# 转换为 profdata
llvm-profdata merge *.profraw -o coverage.profdata

# 导出为 Cobertura 格式（需要 llvm-cov-to-cobertura 工具）
llvm-cov export ./my_app -instr-profile=coverage.profdata \
  -format=lcov > coverage.lcov
lcov_cobertura coverage.lcov -o coverage.cobertura.xml
```

**GCC (gcov)**:
```bash
# 运行测试
./run_tests.sh

# 生成 LCOV 覆盖率
lcov --capture --directory . --output-file coverage.info

# 转换为 Cobertura
lcov_cobertura coverage.info -o coverage.cobertura.xml
```

#### 3️⃣ 构建映射数据库

```bash
# 构建 TiaCC CLI
cd TiaCC
dotnet build -c Release

# 初始化并映射
dotnet run --project TiaCC.Cli -- init --db ../../impact_map.db
dotnet run --project TiaCC.Cli -- map \
  --db ../../impact_map.db \
  --coverage ../../coverage.cobertura.xml \
  --test AllTests
```

---

## 🎯 场景 4: Java 项目

### 步骤

#### 1️⃣ 配置 JaCoCo

在 `pom.xml` 中添加:
```xml
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <version>0.8.11</version>
  <executions>
    <execution>
      <goals>
        <goal>prepare-agent</goal>
      </goals>
    </execution>
    <execution>
      <id>report</id>
      <phase>test</phase>
      <goals>
        <goal>report</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

#### 2️⃣ 运行测试并生成覆盖率

```bash
mvn test
# 生成 target/site/jacoco/jacoco.xml
```

#### 3️⃣ 转换 JaCoCo 为 Cobertura

```bash
# 使用 cover2cover 或其他工具转换
pip install cover2cover
cover2cover target/site/jacoco/jacoco.xml src/main/java > coverage.cobertura.xml
```

#### 4️⃣ 构建映射数据库

```bash
cd TiaCC
dotnet build -c Release

dotnet run --project TiaCC.Cli -- init --db ../../impact_map.db
dotnet run --project TiaCC.Cli -- map \
  --db ../../impact_map.db \
  --coverage ../../coverage.cobertura.xml \
  --test AllTests
```

---

## 🔄 GitHub Actions 集成

创建 `.github/workflows/tiacc.yml`:

```yaml
name: TiaCC Smart Testing

on: [push, pull_request]

jobs:
  smart-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 需要完整历史来做 diff

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Build TiaCC
        run: dotnet build src/TiaCC.DotNet.sln -c Release

      # Nightly: 构建映射数据库
      - name: Run tests with coverage
        if: github.ref == 'refs/heads/main'
        run: |
          dotnet test --collect:"XPlat Code Coverage" \
            --results-directory ./coverage

      - name: Build impact map
        if: github.ref == 'refs/heads/main'
        run: |
          dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- init --db impact_map.db

          for coverage_file in ./coverage/**/coverage.cobertura.xml; do
            TEST_NAME=$(basename $(dirname "$coverage_file"))
            dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- map \
              --db impact_map.db \
              --coverage "$coverage_file" \
              --test "$TEST_NAME" || true
          done

      - name: Upload impact map
        if: github.ref == 'refs/heads/main'
        uses: actions/upload-artifact@v4
        with:
          name: tiacc-db
          path: impact_map.db

      # PR: 智能测试选择
      - name: Download impact map
        if: github.event_name == 'pull_request'
        uses: dawidd6/action-download-artifact@v3
        with:
          workflow: tiacc.yml
          name: tiacc-db
        continue-on-error: true

      - name: Get affected tests
        if: github.event_name == 'pull_request'
        id: tiacc
        run: |
          if [ -f impact_map.db ]; then
            CHANGED=$(git diff --name-only origin/${{ github.base_ref }})
            AFFECTED=$(dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
              --db impact_map.db \
              --files $CHANGED 2>/dev/null || echo "")
            echo "affected=$AFFECTED" >> $GITHUB_OUTPUT
          fi

      - name: Run tests
        run: |
          if [ -n "${{ steps.tiacc.outputs.affected }}" ]; then
            echo "Running affected tests:"
            echo "${{ steps.tiacc.outputs.affected }}"
            FILTER=$(echo "${{ steps.tiacc.outputs.affected }}" | tr '\n' '|' | sed 's/|$//')
            dotnet test --filter "FullyQualifiedName~$FILTER"
          else
            echo "Running all tests"
            dotnet test
          fi
```

---

## 📊 效果示例

### 传统方式
```
PR #123: 修改了 src/Calculator.cs

运行测试:
✓ CalculatorTests     (2.3s)
✓ UtilsTests          (1.8s)
✓ DatabaseTests       (5.2s)
✓ ApiTests            (4.1s)
✓ AuthTests           (3.6s)

总耗时: 17 秒
```

### 使用 TiaCC
```
PR #123: 修改了 src/Calculator.cs

🎯 TiaCC 分析:
  检测到变更: src/Calculator.cs
  推荐测试: CalculatorTests

运行测试:
✓ CalculatorTests     (2.3s)

总耗时: 2.3 秒 ⚡️ (节省 86%)
```

---

## 🎁 额外功能

### 可视化 Dashboard

```bash
# 导出数据
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- export \
  --db impact_map.db \
  --output src/dashboard/dotnet/TiaCC.Dashboard/wwwroot/data

# 启动 dashboard
dotnet run --project src/dashboard/dotnet/TiaCC.Dashboard/TiaCC.Dashboard.csproj -c Release
```

### 查询特定文件的测试覆盖

```bash
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
  --db impact_map.db \
  --files src/Calculator.cs

# 输出:
# Tests covering src/Calculator.cs:
#   - CalculatorTests
#   - IntegrationTests
```

### 数据库统计

```bash
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- stats --db impact_map.db

# 输出:
# 📊 Database Statistics:
#   Total source files: 45
#   Total tests: 120
#   Total mappings: 892
```

---

## 💡 最佳实践

1. **Nightly 构建**: 每天或每周在主分支重新构建映射数据库
2. **PR 验证**: 在 PR 中使用 TiaCC 推荐但不强制，仍然定期运行全量测试
3. **缓存数据库**: 在 CI 中缓存映射数据库以加快速度
4. **监控准确性**: 定期验证 TiaCC 的推荐是否准确

---

## 🆘 常见问题

**Q: TiaCC 会遗漏测试吗？**
A: TiaCC 基于代码覆盖率分析，如果测试之间有间接依赖，可能会遗漏。建议定期运行全量测试作为安全网。

**Q: 支持单元测试吗？**
A: 是的！TiaCC 主要用于单元测试和集成测试。对于 E2E 测试，由于覆盖范围广，推荐效果可能不明显。

**Q: 数据库多久需要重建？**
A: 建议每次主分支更新后重建。

**Q: 可以在本地开发中使用吗？**
A: 当然！在本地修改代码后，运行 query 命令查看需要运行哪些测试。

---

## 📚 更多资源

- [完整文档](https://github.com/your-org/TiaCC/tree/main/docs)
- [CI 模板](https://github.com/your-org/TiaCC/tree/main/ci-templates)
- [Dashboard 可视化](dashboard.md)

---

**🎉 开始使用 TiaCC，让您的 CI 快如闪电！**
