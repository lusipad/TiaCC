# TiaCC Tools (Node.js/TypeScript)

TiaCC 的核心 CLI 工具集，使用 TypeScript 构建，提供覆盖率处理、映射生成和测试推荐功能。

## 功能

- **tia-mapper**: 处理覆盖率数据并构建源文件→测试的映射数据库
- **tia-recommend**: 分析 Git 变更并推荐受影响的测试
- **test-runner**: 内置测试运行器，支持覆盖率采集

## 安装

```bash
npm install
npm run build
```

## CLI 命令

### tia-mapper

映射生成器 - 处理覆盖率数据并构建映射数据库。

#### 支持的覆盖率格式

| 格式 | 扩展名 | 描述 |
|------|--------|------|
| LLVM Profile Raw | `.profraw` | 需要 llvm-profdata 和 llvm-cov 处理 |
| LLVM JSON | `.cov.json` | 预处理的 LLVM JSON 导出 ⭐ 推荐 |
| Coverlet JSON | `.coverage.json` | .NET Coverlet 格式 |

#### 命令

```bash
# 构建映射数据库
npx tsx src/cli/mapper.ts build \
  --coverage-dir ./coverage_data \
  --db impact_map.db \
  [--executable <path>] \
  [--commit <hash>] \
  [--verbose]

# 查看数据库统计
npx tsx src/cli/mapper.ts stats --db impact_map.db

# 查询源文件对应的测试
npx tsx src/cli/mapper.ts query <source-file> --db impact_map.db

# 导出数据到 JSON (用于 Dashboard)
npx tsx src/cli/mapper.ts export \
  --db impact_map.db \
  --output ./dashboard/data
```

#### 示例

```bash
# 处理 LLVM JSON 覆盖率文件
npx tsx src/cli/mapper.ts build \
  --coverage-dir ../tests/e2e/cpp-project/coverage_data \
  --db ../tests/e2e/cpp-project/impact_map.db \
  --verbose

# 输出:
# ℹ Found 0 C++ profraw files
# ℹ Found 4 LLVM JSON files
# ℹ Found 0 C# coverage files
# ✔ Processed 4 LLVM JSON coverage files
# Build Complete!
#   Source files: 7
#   Test scripts: 4
#   File mappings: 9
```

### tia-recommend

测试推荐器 - 分析 Git 变更并推荐需要运行的测试。

```bash
# 推荐受影响的测试
npx tsx src/cli/recommend.ts \
  --db impact_map.db \
  [--base HEAD~1] \
  [--branch origin/main] \
  [--level file|function] \
  [--output tests.txt] \
  [--json] \
  [--quiet]
```

#### 示例

```bash
# 相对于 main 分支的变更
npx tsx src/cli/recommend.ts --db impact_map.db --branch origin/main

# 相对于上一个提交
npx tsx src/cli/recommend.ts --db impact_map.db --base HEAD~1

# 函数级精确推荐
npx tsx src/cli/recommend.ts --db impact_map.db --level function

# 输出到文件
npx tsx src/cli/recommend.ts --db impact_map.db --output affected.txt
```

## 核心模块

### coverage-parser.ts

覆盖率解析器，支持多种格式：

```typescript
import { CppCoverageParser, CSharpCoverageParser, LlvmJsonCoverageParser } from './coverage-parser.js';

// LLVM profraw (需要 llvm-cov)
const cppParser = new CppCoverageParser({ executable: './app' });
const data = await cppParser.parse('test.profraw');

// 预处理的 LLVM JSON
const llvmParser = new LlvmJsonCoverageParser();
const data = await llvmParser.parse('test.cov.json');

// Coverlet JSON
const csharpParser = new CSharpCoverageParser();
const data = await csharpParser.parse('test.coverage.json');
```

### database.ts

SQLite 数据库操作封装：

```typescript
import { TiaDatabase, initDatabase } from './database.js';

// 初始化数据库
const db = initDatabase('impact_map.db');

// 插入源文件
const sourceId = db.upsertSourceFile('src/main.cpp', 'hash123');

// 插入测试
const testId = db.upsertTestScript('tests/test_main.lua');

// 添加映射
db.addCoverageMapping(sourceId, testId, 85.5);

// 查询
const tests = db.getTestsForSource('main.cpp');

// 统计
const stats = db.getStats();
```

### git-utils.ts

Git 工具函数：

```typescript
import { GitUtils } from './git-utils.js';

const git = new GitUtils();

// 获取变更文件
const files = await git.getChangedFiles({ baseRef: 'origin/main' });

// 获取变更行
const lines = await git.getChangedLines('src/main.cpp', 'origin/main');

// 分析变更规模
const scale = await git.analyzeChangeScale('origin/main');
// { totalFiles: 5, totalLines: 120, scale: 'small' }
```

### symbol-extractor.ts

从覆盖率数据中提取符号信息：

```typescript
import { SymbolExtractor } from './symbol-extractor.js';

const extractor = new SymbolExtractor();

// 从 LLVM JSON 提取
const symbols = extractor.extractFromLlvmCov(llvmJson);

// 从 Coverlet JSON 提取
const symbols = extractor.extractFromCoverlet(coverletJson);
```

## 数据库结构

```
impact_map.db
├── source_files      # 源文件表
│   ├── id
│   ├── file_path
│   ├── file_hash
│   └── last_updated
├── test_scripts      # 测试表
│   ├── id
│   ├── script_path
│   ├── last_run
│   └── avg_duration_ms
├── coverage_map      # 映射表
│   ├── source_file_id
│   ├── test_script_id
│   ├── line_coverage_pct
│   └── created_at
├── symbols           # 符号表 (函数/类)
│   ├── id
│   ├── source_file_id
│   ├── name
│   ├── type
│   ├── start_line
│   └── end_line
├── symbol_coverage   # 符号覆盖表
│   ├── symbol_id
│   ├── test_script_id
│   ├── hit_count
│   └── line_coverage_pct
└── coverage_runs     # 运行历史
    ├── id
    ├── run_date
    ├── total_tests
    ├── total_sources
    └── commit_hash
```

## 测试

```bash
# 运行单元测试
npm test

# 运行覆盖率
npm run test:coverage

# 监听模式
npm run test:watch
```

## 开发

```bash
# 构建
npm run build

# 类型检查
npm run typecheck

# 格式化
npm run format

# Lint
npm run lint
```

## 依赖

- **better-sqlite3**: SQLite 数据库
- **commander**: CLI 框架
- **glob**: 文件匹配
- **ora**: 进度指示器
- **simple-git**: Git 操作

## 许可证

MIT
