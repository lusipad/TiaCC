# 🚀 TiaCC 快速入门指南

## 在您的项目中使用 TiaCC (5 分钟)

TiaCC 是一个通用的测试影响分析工具，可以集成到**任何项目**中。

---

## 📋 前置条件

1. 项目有自动化测试
2. 测试框架能生成覆盖率报告
3. 支持的覆盖率格式之一：
   - Cobertura XML (通用)
   - LCOV (C++/Go)
   - JaCoCo (Java)
   - Istanbul/nyc (JavaScript/TypeScript)
   - coverage.py (Python)
   - Coverlet (C#/.NET)

---

## 🎯 场景 1: JavaScript/TypeScript 项目

### 项目结构
```
my-project/
├── src/
│   ├── utils.ts
│   └── calculator.ts
├── tests/
│   ├── utils.test.ts
│   └── calculator.test.ts
├── package.json
└── vitest.config.ts (或 jest.config.js)
```

### 步骤

#### 1️⃣ 配置测试框架生成 Cobertura 覆盖率

**Vitest** (`vitest.config.ts`):
```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['cobertura', 'text'],
    },
  },
});
```

**Jest** (`jest.config.js`):
```javascript
module.exports = {
  coverageReporters: ['cobertura', 'text'],
};
```

#### 2️⃣ 安装 TiaCC

```bash
npm install -D @tiacc/tools
```

#### 3️⃣ 添加脚本到 `package.json`

```json
{
  "scripts": {
    "test:coverage": "vitest run --coverage",
    "tiacc:build": "tia-mapper build --coverage-dir ./coverage --db tiacc.db",
    "tiacc:recommend": "tia-recommend --db tiacc.db"
  }
}
```

#### 4️⃣ Nightly 构建映射数据库

```bash
# 在 main 分支或 nightly CI 中运行
npm run test:coverage
npm run tiacc:build
```

#### 5️⃣ PR 时获取受影响的测试

```bash
# 检测变更的文件
git diff --name-only origin/main...HEAD > changed.txt

# 获取受影响的测试
npm run tiacc:recommend -- --branch origin/main

# 输出示例:
# 🎯 Recommended tests:
#   ✓ tests/calculator.test.ts
# 💡 You can skip 3 out of 4 tests (75% reduction)
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

#### 1️⃣ 安装 TiaCC 和 coverage.py

```bash
pip install coverage
npm install -g @tiacc/tools
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
tia-mapper build \
  --coverage-dir ./coverage \
  --db tiacc.db \
  --coveragepy
```

#### 5️⃣ 获取受影响的测试

```bash
tia-recommend \
  --db tiacc.db \
  --changed-files src/calculator.py
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

# 导出 JSON
llvm-cov export ./my_app -instr-profile=coverage.profdata \
  -format=text > coverage.json
```

**GCC (gcov)**:
```bash
# 运行测试
./run_tests.sh

# 生成 LCOV 覆盖率
lcov --capture --directory . --output-file coverage.info
```

#### 3️⃣ 构建映射数据库

```bash
# LLVM 格式
tia-mapper build \
  --coverage-dir ./coverage \
  --db tiacc.db \
  --executable ./my_app

# LCOV 格式
tia-mapper build \
  --coverage-dir . \
  --db tiacc.db \
  --lcov \
  --lcov-pattern "*.info"
```

---

## 🎯 场景 4: .NET/C# 项目

### 步骤

#### 1️⃣ 安装 Coverlet

```bash
dotnet add package coverlet.collector
```

#### 2️⃣ 运行测试并生成覆盖率

```bash
dotnet test \
  --collect:"XPlat Code Coverage" \
  --results-directory ./TestResults \
  -- DataCollectionRunSettings.DataCollectors.DataCollector.Configuration.Format=cobertura
```

#### 3️⃣ 构建映射数据库

```bash
tia-mapper build \
  --coverage-dir ./TestResults \
  --db tiacc.db
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

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Install TiaCC
        run: npm install -g @tiacc/tools

      # Nightly: 构建映射数据库
      - name: Build impact map
        if: github.ref == 'refs/heads/main'
        run: |
          npm run test:coverage
          tia-mapper build -c ./coverage -d tiacc.db

      - name: Upload impact map
        if: github.ref == 'refs/heads/main'
        uses: actions/upload-artifact@v4
        with:
          name: tiacc-db
          path: tiacc.db

      # PR: 智能测试选择
      - name: Download impact map
        if: github.event_name == 'pull_request'
        uses: dawidd6/action-download-artifact@v3
        with:
          workflow: tiacc.yml
          name: tiacc-db

      - name: Get affected tests
        if: github.event_name == 'pull_request'
        run: |
          tia-recommend --db tiacc.db --branch origin/${{ github.base_ref }} \
            --output affected_tests.txt

          if [ -s affected_tests.txt ]; then
            echo "Running only affected tests:"
            cat affected_tests.txt
            # 根据您的测试框架运行指定的测试
            npm test -- $(cat affected_tests.txt)
          else
            echo "Running all tests"
            npm test
          fi
```

---

## 📊 效果示例

### 传统方式
```
PR #123: 修改了 src/calculator.ts

运行测试:
✓ test_calculator.test.ts    (2.3s)
✓ test_utils.test.ts          (1.8s)
✓ test_database.test.ts       (5.2s)
✓ test_api.test.ts            (4.1s)
✓ test_auth.test.ts           (3.6s)

总耗时: 17 秒
```

### 使用 TiaCC
```
PR #123: 修改了 src/calculator.ts

🎯 TiaCC 分析:
  检测到变更: src/calculator.ts
  推荐测试: test_calculator.test.ts

运行测试:
✓ test_calculator.test.ts    (2.3s)

总耗时: 2.3 秒 ⚡️ (节省 86%)
```

---

## 🎁 额外功能

### 可视化 Dashboard

```bash
# 导出数据
tia-mapper export --db tiacc.db --output dashboard-data.json

# 启动 dashboard (如果克隆了 TiaCC 仓库)
cd TiaCC/dashboard
python -m http.server 8080
```

### 查询特定文件的测试覆盖

```bash
tia-mapper query src/calculator.ts --db tiacc.db

# 输出:
# Tests covering src/calculator.ts:
#   - test_calculator.test.ts
#   - test_integration.test.ts
```

### 数据库统计

```bash
tia-mapper stats --db tiacc.db

# 输出:
# 📊 Database Statistics:
#   Total source files: 45
#   Total tests: 120
#   Average tests per file: 2.7
#   Files with no coverage: 3
```

---

## 💡 最佳实践

1. **Nightly 构建**: 每天或每周在主分支重新构建映射数据库
2. **PR 验证**: 在 PR 中使用 TiaCC 推荐但不强制，仍然定期运行全量测试
3. **增量更新**: 使用 `tia-mapper update` 而不是每次完全重建
4. **缓存数据库**: 在 CI 中缓存映射数据库以加快速度
5. **监控准确性**: 定期验证 TiaCC 的推荐是否准确

---

## 🆘 常见问题

**Q: TiaCC 会遗漏测试吗？**
A: TiaCC 基于代码覆盖率分析，如果测试之间有间接依赖，可能会遗漏。建议定期运行全量测试作为安全网。

**Q: 支持单元测试吗？**
A: 是的！TiaCC 主要用于单元测试和集成测试。对于 E2E 测试，由于覆盖范围广，推荐效果可能不明显。

**Q: 数据库多久需要重建？**
A: 建议每次主分支更新后重建，或者使用 `update` 命令增量更新。

**Q: 可以在本地开发中使用吗？**
A: 当然！在本地修改代码后，运行 `tia-recommend` 查看需要运行哪些测试。

---

## 📚 更多资源

- [完整文档](https://github.com/your-org/TiaCC/tree/main/docs)
- [CI 模板](https://github.com/your-org/TiaCC/tree/main/ci-templates)
- [示例项目](https://github.com/your-org/TiaCC/tree/main/examples)
- [Dogfooding 案例](https://github.com/your-org/TiaCC/tree/main/tools-node/docs/DOGFOODING.md)

---

**🎉 开始使用 TiaCC，让您的 CI 快如闪电！**
