# @tiacc/tools

> Smart test selection based on code coverage - Run only the tests affected by your changes

[![npm version](https://img.shields.io/npm/v/@tiacc/tools.svg)](https://www.npmjs.com/package/@tiacc/tools)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TiaCC 的核心工具集，使用 TypeScript 构建，提供覆盖率处理、映射生成和测试推荐功能。

**将 30 分钟的 CI 测试缩短到 3-5 分钟！**

## 功能

- **TiaCC 高层 API**: 简单易用的集成接口
- **tia-mapper**: 处理覆盖率数据并构建源文件→测试的映射数据库
- **tia-recommend**: 分析 Git 变更并推荐受影响的测试
- **test-runner**: 内置测试运行器，支持覆盖率采集

## 安装

```bash
# 全局安装（推荐用于 CLI）
npm install -g @tiacc/tools

# 或作为项目依赖
npm install @tiacc/tools --save-dev
```

### 从源码安装

```bash
git clone https://github.com/your-org/TiaCC.git
cd TiaCC/tools-node
npm install
npm run build
npm link  # 创建全局命令
```

### 离线环境安装

本工具依赖 `better-sqlite3`，这是一个需要编译原生代码的 npm 包。在离线环境中安装需要额外步骤：

#### 方法 1: 使用 npm 镜像（推荐）

```bash
# 设置 npm 镜像
npm config set registry https://registry.npmmirror.com

# 设置 better-sqlite3 预编译二进制镜像
npm config set better_sqlite3_binary_host https://npmmirror.com/mirrors/better-sqlite3

# 然后正常安装
npm install
```

#### 方法 2: 预先下载二进制文件

在有网络的环境中：

```bash
# 下载预编译二进制到本地
npm install better-sqlite3
# 将 node_modules/better-sqlite3/prebuilds 目录打包
```

在离线环境中：

```bash
# 解压预编译二进制到项目目录
# 然后运行
npm install --ignore-scripts
```

#### 方法 3: 本地编译（需要编译工具链）

```bash
# 确保安装了编译工具
# Ubuntu/Debian: apt-get install build-essential python3
# macOS: xcode-select --install
# Windows: npm install -g windows-build-tools

npm install --build-from-source
```

## 快速开始

### 高层 API（推荐）

```typescript
import { TiaCC } from '@tiacc/tools';

// 初始化
const tia = await TiaCC.init('./impact_map.db');

// 构建映射（在 Nightly CI 中执行）
await tia.buildMapping('./coverage');

// 获取受影响的测试（在 PR 检查中执行）
const result = await tia.getAffectedTests({ baseBranch: 'origin/main' });

console.log(`运行 ${result.tests.length} 个测试（节省 ${result.savingsPercent}%）`);
for (const test of result.tests) {
  console.log(`  - ${test}`);
}
```

### CLI 快速使用

```bash
# 1. 构建映射数据库（在 Nightly CI 中执行）
tia-mapper build --coverage-dir ./coverage --db impact_map.db

# 2. 获取受影响的测试（在 PR 检查中执行）
tia-recommend --db impact_map.db --branch origin/main
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
