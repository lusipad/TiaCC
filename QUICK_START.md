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

| 命令 | 说明 |
|------|------|
| `tia-mapper build` | 从覆盖率数据构建映射数据库 |
| `tia-mapper stats` | 查看数据库统计信息 |
| `tia-mapper query <file>` | 查询某文件被哪些测试覆盖 |
| `tia-recommend` | 获取受影响的测试列表 |
| `tia-recommend --json` | 以 JSON 格式输出结果 |

---

## 下一步

- 📖 [完整文档](docs/architecture.md)
- 🔧 [详细集成指南](docs/integration-guide.md)
- 📊 [Dashboard 使用](dashboard/README.md)
- 🧪 [E2E 测试示例](tests/e2e/README.md)

---

## 获取帮助

```bash
tia-mapper --help
tia-recommend --help
```

有问题？请提交 [Issue](https://github.com/your-org/TiaCC/issues)
