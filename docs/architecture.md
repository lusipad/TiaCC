# TiaCC 架构设计文档

## 1. 系统概述

TiaCC (Test Impact Analysis for Code Coverage) 是一个跨平台测试影响分析系统，通过代码覆盖率分析将代码变更映射到受影响的测试，实现精准测试选择。

### 1.1 核心价值

| 传统方式 | TiaCC 方式 |
|---------|-----------|
| 每次提交运行全量测试 | 只运行受影响的测试 |
| CI 时间长 (30min+) | CI 时间短 (5min-) |
| 资源浪费 | 资源高效利用 |
| 开发反馈慢 | 快速反馈 |

### 1.2 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TiaCC 系统架构                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │   源代码        │    │   测试代码       │    │   测试框架       │         │
│  │  C++/C#/...    │    │   Lua/Python/   │    │   自定义         │         │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘         │
│           │                      │                      │                   │
│           ▼                      ▼                      ▼                   │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                        编译阶段                                  │       │
│  │  ┌─────────────────┐    ┌─────────────────────────────────────┐ │       │
│  │  │  LLVM Profile   │    │  Coverlet (C#)                      │ │       │
│  │  │  覆盖率插桩     │    │  覆盖率插桩                          │ │       │
│  │  └─────────────────┘    └─────────────────────────────────────┘ │       │
│  └──────────────────────────────┬──────────────────────────────────┘       │
│                                 │                                           │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                        运行阶段                                  │       │
│  │                                                                 │       │
│  │    ┌─────────────┐         ┌─────────────┐                     │       │
│  │    │ 测试客户端  │◀──IPC──▶│ 覆盖率服务   │                     │       │
│  │    │ (Lua/Py/..) │         │ (C++/.NET)  │                     │       │
│  │    └──────┬──────┘         └──────┬──────┘                     │       │
│  │           │                       │                             │       │
│  │           ▼                       ▼                             │       │
│  │    ┌─────────────────────────────────────────┐                 │       │
│  │    │            覆盖率数据文件                │                 │       │
│  │    │  .profraw (LLVM) / .coverage.json (C#)  │                 │       │
│  │    └──────────────────────┬──────────────────┘                 │       │
│  └───────────────────────────┼──────────────────────────────────────┘       │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                        分析阶段                                  │       │
│  │                                                                 │       │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │       │
│  │  │ llvm-cov    │    │ tia-mapper  │    │ SQLite DB   │         │       │
│  │  │ (LLVM工具)  │───▶│ (映射生成)  │───▶│ (映射存储)  │         │       │
│  │  └─────────────┘    └─────────────┘    └──────┬──────┘         │       │
│  │                                               │                 │       │
│  │                                               ▼                 │       │
│  │                                        ┌─────────────┐         │       │
│  │                                        │tia-recommend│         │       │
│  │                                        │ (测试推荐)  │         │       │
│  │                                        └──────┬──────┘         │       │
│  └───────────────────────────────────────────────┼──────────────────┘       │
│                                                  │                          │
│                                                  ▼                          │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                        输出                                     │       │
│  │    受影响的测试列表 / CI 集成 / Dashboard 可视化                 │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心组件

### 2.1 覆盖率采集模块

#### 2.1.1 C++ 覆盖率 (LLVM Profile)

```
src/cpp/
├── include/
│   ├── tia/coverage_api.h     # 覆盖率控制 API
│   ├── tia/ipc_server.h       # IPC 服务器
│   └── tia/profile_control.h  # Profile Runtime 控制
└── src/
    ├── coverage_api.cpp
    ├── ipc_server.cpp
    ├── main.cpp               # 独立服务入口
    └── profile_control.cpp
```

**核心功能：**
- 使用 LLVM Profile Runtime API 控制覆盖率收集
- 提供 JSON-RPC 接口供测试框架调用
- 支持 `startRecording`, `stopRecording`, `dumpCoverage` 等操作

#### 2.1.2 C# 覆盖率 (Coverlet)

```
src/dotnet/
├── TiaCC.Coverage/           # 覆盖率库
│   ├── CoverageController.cs
│   └── CoverageExporter.cs
└── TiaCC.CoverageService/    # 覆盖率服务
    └── Program.cs
```

### 2.2 测试框架客户端

```
clients/
├── tia_hooks.lua    # Lua 客户端 (主要)
├── tia_hooks.py     # Python 客户端
├── TiaHooks.cs      # C# 客户端
├── tia_hooks.ts     # TypeScript 客户端
└── tia_hooks.go     # Go 客户端
```

**客户端职责：**
1. 与覆盖率服务建立 IPC 连接
2. 在测试前后发送信号
3. 管理录制模式 (精确/批量)

### 2.3 CLI 工具 (tools-node)

```
tools-node/
└── src/
    ├── cli/
    │   ├── mapper.ts       # 映射生成器
    │   └── recommend.ts    # 测试推荐器
    ├── coverage-parser.ts  # 覆盖率解析器
    ├── database.ts         # SQLite 数据库操作
    ├── git-utils.ts        # Git 集成
    ├── symbol-extractor.ts # 符号提取器
    └── test-runner.ts      # 测试运行器
```

---

## 3. 数据流设计

### 3.1 覆盖率收集流程

```
┌─────────────┐
│  测试开始   │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────┐
│ TiaHooks:beforeTest("test_001") │
│  ├─ 发送 startRecording RPC      │
│  └─ 服务器开始追踪覆盖率         │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│         执行测试代码              │
│  (覆盖率数据累积到内存中)         │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ TiaHooks:afterTest("test_001")  │
│  ├─ 发送 stopRecording RPC       │
│  ├─ 发送 dumpCoverage RPC        │
│  └─ 生成 test_001.profraw        │
└──────────────┬───────────────────┘
               │
               ▼
┌─────────────┐
│  测试结束   │
└─────────────┘
```

### 3.2 映射构建流程

```
┌────────────────────────────────────────────────────────────────────┐
│                        Nightly 映射构建                            │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  1. 收集覆盖率文件                                                 │
│     coverage_data/                                                 │
│     ├── test_001.profraw  ──┐                                     │
│     ├── test_002.profraw    │                                     │
│     └── ...                 │                                     │
│                             ▼                                     │
│  2. 处理覆盖率数据                                                 │
│     ┌─────────────────────────────────────────────┐               │
│     │ llvm-profdata merge *.profraw -o merged.profdata │          │
│     │ llvm-cov export app -instr-profile=... -format=json │       │
│     └─────────────────────────────────────────────┘               │
│                             │                                     │
│                             ▼                                     │
│  3. 解析并存储映射                                                 │
│     ┌─────────────────────────────────────────────┐               │
│     │  tia-mapper build                            │               │
│     │    --coverage-dir ./coverage_data            │               │
│     │    --db impact_map.db                        │               │
│     └─────────────────────────────────────────────┘               │
│                             │                                     │
│                             ▼                                     │
│  4. 输出映射数据库                                                 │
│     impact_map.db                                                  │
│     ├── source_files (源文件表)                                    │
│     ├── test_scripts (测试表)                                      │
│     ├── coverage_map (映射表)                                      │
│     ├── symbols (符号表)                                           │
│     └── symbol_coverage (符号覆盖表)                               │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 3.3 测试推荐流程

```
┌────────────────────────────────────────────────────────────────────┐
│                          PR 测试推荐                               │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  1. 获取变更文件                                                   │
│     git diff origin/main --name-only                               │
│     → src/engine/physics.cpp                                       │
│     → src/engine/collision.cpp                                     │
│                                                                    │
│  2. 查询映射数据库                                                 │
│     SELECT DISTINCT t.script_path                                  │
│     FROM coverage_map cm                                           │
│     JOIN source_files s ON cm.source_file_id = s.id                │
│     JOIN test_scripts t ON cm.test_script_id = t.id                │
│     WHERE s.file_path LIKE '%physics.cpp'                          │
│        OR s.file_path LIKE '%collision.cpp'                        │
│                                                                    │
│  3. 返回推荐测试                                                   │
│     → tests/test_physics_basic.lua                                 │
│     → tests/test_physics_advanced.lua                              │
│     → tests/test_collision.lua                                     │
│     → tests/test_integration.lua                                   │
│                                                                    │
│  4. 可选：函数级精确推荐                                           │
│     如果只修改了 Physics::update() 函数                            │
│     → 只推荐覆盖该函数的测试                                        │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 4. 数据库设计

### 4.1 ER 图

```
┌───────────────────┐       ┌───────────────────┐
│   source_files    │       │   test_scripts    │
├───────────────────┤       ├───────────────────┤
│ id (PK)           │       │ id (PK)           │
│ file_path         │       │ script_path       │
│ file_hash         │       │ last_run          │
│ last_updated      │       │ avg_duration_ms   │
└─────────┬─────────┘       └─────────┬─────────┘
          │                           │
          │    ┌─────────────────┐    │
          └───▶│  coverage_map   │◀───┘
               ├─────────────────┤
               │ source_file_id  │
               │ test_script_id  │
               │ line_coverage   │
               │ created_at      │
               └─────────────────┘

┌───────────────────┐       ┌───────────────────┐
│     symbols       │       │  symbol_coverage  │
├───────────────────┤       ├───────────────────┤
│ id (PK)           │       │ symbol_id (FK)    │
│ source_file_id(FK)│◀──────│ test_script_id(FK)│
│ name              │       │ hit_count         │
│ type              │       │ line_coverage_pct │
│ start_line        │       └───────────────────┘
│ end_line          │
│ signature         │
└───────────────────┘

┌───────────────────┐
│  coverage_runs    │
├───────────────────┤
│ id (PK)           │
│ run_date          │
│ total_tests       │
│ total_sources     │
│ commit_hash       │
└───────────────────┘
```

### 4.2 表结构

```sql
-- 源文件表
CREATE TABLE source_files (
    id INTEGER PRIMARY KEY,
    file_path TEXT NOT NULL UNIQUE,
    file_hash TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 测试表
CREATE TABLE test_scripts (
    id INTEGER PRIMARY KEY,
    script_path TEXT NOT NULL UNIQUE,
    last_run DATETIME,
    avg_duration_ms INTEGER
);

-- 覆盖率映射表
CREATE TABLE coverage_map (
    source_file_id INTEGER NOT NULL,
    test_script_id INTEGER NOT NULL,
    line_coverage_pct REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source_file_id, test_script_id),
    FOREIGN KEY (source_file_id) REFERENCES source_files(id),
    FOREIGN KEY (test_script_id) REFERENCES test_scripts(id)
);

-- 符号表 (函数/方法/类)
CREATE TABLE symbols (
    id INTEGER PRIMARY KEY,
    source_file_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'function',
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    signature TEXT,
    FOREIGN KEY (source_file_id) REFERENCES source_files(id)
);

-- 符号覆盖表
CREATE TABLE symbol_coverage (
    symbol_id INTEGER NOT NULL,
    test_script_id INTEGER NOT NULL,
    hit_count INTEGER DEFAULT 0,
    line_coverage_pct REAL DEFAULT 0,
    PRIMARY KEY (symbol_id, test_script_id),
    FOREIGN KEY (symbol_id) REFERENCES symbols(id),
    FOREIGN KEY (test_script_id) REFERENCES test_scripts(id)
);

-- 覆盖率运行历史
CREATE TABLE coverage_runs (
    id INTEGER PRIMARY KEY,
    run_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_tests INTEGER,
    total_sources INTEGER,
    commit_hash TEXT
);
```

---

## 5. 录制模式

### 5.1 精确模式 (Precise Mode)

```
测试执行时序：
────────────────────────────────────────────────────────────────
test_001 ──────┬──────────────────┬─────
               │    执行测试       │
               │                  │
          beforeTest         afterTest
          startRecording     stopRecording
                             dumpCoverage
                             → test_001.profraw

test_002 ──────┬──────────────────┬─────
               │    执行测试       │
               │                  │
          beforeTest         afterTest
          startRecording     stopRecording
                             dumpCoverage
                             → test_002.profraw
────────────────────────────────────────────────────────────────

优点：1:1 精确映射每个测试
缺点：IO 开销大 (每个测试一个文件)
适用：测试数量 < 1000
```

### 5.2 批量模式 (Bucket Mode)

```
测试执行时序 (bucketSize = 3)：
────────────────────────────────────────────────────────────────
test_001 ─┬─────┬─
          │     │
test_002 ─┼─────┼─    Bucket 0
          │     │
test_003 ─┴─────┴─────────────────┐
                                  │
                              flushBucket
                              → bucket_0.profraw
                              (包含 test_001,002,003 的覆盖率)

test_004 ─┬─────┬─
          │     │
test_005 ─┼─────┼─    Bucket 1
          │     │
test_006 ─┴─────┴─────────────────┐
                                  │
                              flushBucket
                              → bucket_1.profraw
────────────────────────────────────────────────────────────────

优点：减少 IO 开销
缺点：映射精度降低
适用：测试数量 > 1000
```

---

## 6. 覆盖率格式支持

### 6.1 支持的格式

| 格式 | 扩展名 | 来源 | 解析器 |
|------|--------|------|--------|
| LLVM Profile Raw | `.profraw` | Clang 编译 | CppCoverageParser |
| LLVM JSON Export | `.cov.json` | llvm-cov export | LlvmJsonCoverageParser |
| Coverlet JSON | `.coverage.json` | dotnet test | CSharpCoverageParser |

### 6.2 LLVM JSON 格式示例

```json
{
  "version": "2.0.0",
  "type": "llvm.coverage.json.export",
  "data": [{
    "files": [{
      "filename": "src/calculator.cpp",
      "functions": [{
        "name": "Calculator::add",
        "count": 10,
        "regions": [[5, 1, 10, 2, 10, 0, 0, 0]]
      }],
      "segments": [
        [5, 1, 10, true, true],
        [10, 2, 0, false, false]
      ]
    }]
  }]
}
```

### 6.3 Coverlet JSON 格式示例

```json
{
  "MyAssembly": {
    "src/Calculator.cs": {
      "Calculator.Add": {
        "Lines": { "10": 5, "11": 5, "12": 0 }
      }
    }
  }
}
```

---

## 7. CLI 命令参考

### 7.1 tia-mapper

```bash
# 构建映射数据库
tia-mapper build \
  --coverage-dir ./coverage_data \
  --db impact_map.db \
  [--executable <path>] \
  [--commit <hash>] \
  [--verbose]

# 查看数据库统计
tia-mapper stats --db impact_map.db

# 查询文件的测试
tia-mapper query <source-file> --db impact_map.db

# 导出数据到 JSON (用于 Dashboard)
tia-mapper export --db impact_map.db --output ./dashboard/data
```

### 7.2 tia-recommend

```bash
# 推荐受影响的测试
tia-recommend \
  --db impact_map.db \
  [--base HEAD~1] \
  [--branch origin/main] \
  [--level file|function] \
  [--output tests.txt] \
  [--json] \
  [--quiet]
```

---

## 8. Dashboard 可视化

### 8.1 概述

TiaCC Dashboard 是一个基于 Web 的交互式可视化工具，用于展示测试影响分析结果和代码覆盖率数据。

**启动方式：**
```bash
cd dashboard
python -m http.server 8080
# 访问 http://localhost:8080/dashboard/
```

### 8.2 核心功能

| 功能 | 描述 |
|------|------|
| **依赖图可视化** | D3.js 力导向图展示源文件与测试的关联关系 |
| **覆盖率热力图** | TreeMap 视图展示文件级覆盖率分布 |
| **函数级详情面板** | 点击源文件节点查看函数列表、覆盖率和关联测试 |
| **文件夹分组** | 按目录结构组织文件，支持折叠/展开和聚合统计 |
| **智能搜索** | 实时过滤文件和图节点，自动展开匹配文件夹 |
| **多选分析** | 批量选择文件进行影响分析 |
| **导出功能** | 复制测试名称、导出 JSON、生成 CI 命令 |

### 8.3 界面布局

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TiaCC Dashboard                                              标题栏    │
├──────────────────────┬──────────────────────────────────────────────────┤
│                      │                                                  │
│  ┌────────────────┐  │   ┌─────────────────────────────────────────┐   │
│  │ 📊 统计卡片     │  │   │                                         │   │
│  │ Sources|Tests  │  │   │                                         │   │
│  └────────────────┘  │   │          依赖图 / 热力图                  │   │
│                      │   │                                         │   │
│  ┌────────────────┐  │   │         ○ Source Node                   │   │
│  │ 📝 查询输入     │  │   │        ╱                                │   │
│  │ [文件路径...]  │  │   │       ●──────◆ Test Node                │   │
│  └────────────────┘  │   │        ╲                                │   │
│                      │   │         ○ Source Node                   │   │
│  ┌────────────────┐  │   │                                         │   │
│  │ 📁 文件列表     │  │   └─────────────────────────────────────────┘   │
│  │ [Recommended]  │  │                                                  │
│  │ [All Files]    │  │   ┌───────────────────────────────────────┐     │
│  │                │  │   │ 📋 详情面板                             │     │
│  │ 📁 src/ [91%]  │  │   │ calculator.cpp                        │     │
│  │   calculator   │  │   │ 98% · 10 funcs · 2 tests              │     │
│  │   statistics   │  │   │                                       │     │
│  │ 📁 tests/      │  │   │ ƒ add() ████████ 100%                 │     │
│  │   test_calc    │  │   │ ƒ subtract() ██████ 95%               │     │
│  └────────────────┘  │   └───────────────────────────────────────┘     │
│                      │                                                  │
└──────────────────────┴──────────────────────────────────────────────────┘
```

### 8.4 文件夹分组功能

**显示结构：**
```
📁 src/                     91%  [3]    ← 聚合覆盖率 · 文件数
   ├─ calculator.cpp
   ├─ statistics.cpp  
   └─ string_utils.cpp
   
📁 tests/                   -    [2]
   ├─ test_calculator_basic.cpp
   └─ test_statistics.cpp
```

**特性：**
- 点击文件夹头可折叠/展开
- 显示文件夹聚合覆盖率（基于符号数据计算）
- 搜索时自动展开包含匹配项的文件夹
- 颜色编码：绿色 ≥80%、黄色 ≥50%、红色 <50%

### 8.5 详情面板

点击图中的源文件节点会打开详情面板，显示：

| 区域 | 内容 |
|------|------|
| **头部** | 文件名、类型标识、路径 |
| **统计** | 平均覆盖率、函数数量、关联测试数 |
| **函数列表** | 每个函数的名称、覆盖率进度条、行号范围、关联测试数 |
| **操作** | "Analyze Impact" 按钮 |

**函数条目示例：**
```
ƒ add()                                    100%
████████████████████████████████████████
Lines 15-22 · 2 tests
```

### 8.6 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Escape` | 关闭详情面板 |
| `Ctrl+Enter` | 执行分析 |
| `Ctrl+Shift+C` | 复制测试名称 |

### 8.7 数据文件

Dashboard 从 `dashboard/data/` 目录加载 JSON 数据：

| 文件 | 内容 |
|------|------|
| `graph.json` | 节点和边的定义（源文件、测试、函数） |
| `symbols.json` | 符号详情（函数名、行号、覆盖率、关联测试） |

**graph.json 结构：**
```json
{
  "nodes": [
    { "id": "src/calculator.cpp", "type": "source" },
    { "id": "tests/test_calc.cpp", "type": "test" },
    { "id": "Calculator::add", "type": "function", "parent": "src/calculator.cpp" }
  ],
  "links": [
    { "source": "src/calculator.cpp", "target": "tests/test_calc.cpp" }
  ]
}
```

**symbols.json 结构：**
```json
{
  "symbols": [
    {
      "symbolName": "Calculator::add",
      "sourceFile": "src/calculator.cpp",
      "startLine": 15,
      "endLine": 22,
      "tests": [
        { "testScript": "test_calc.cpp", "coverage": 100, "hitCount": 5 }
      ]
    }
  ]
}
```

---

## 9. 扩展点

### 9.1 添加新的覆盖率格式

```typescript
// 继承 CoverageParser 基类
export class NewFormatParser extends CoverageParser {
  getFileExtension(): string {
    return '.new-format';
  }

  async parse(coverageFile: string): Promise<CoverageData | null> {
    // 实现解析逻辑
  }
}
```

### 9.2 添加新的客户端语言

参考现有客户端实现 JSON-RPC 通信：

```
必需接口:
- connect()           # 建立连接
- startRecording()    # 开始录制
- stopRecording()     # 停止录制
- dumpCoverage()      # 导出覆盖率
- disconnect()        # 断开连接
```

---

## 10. 性能考量

### 10.1 映射数据库大小

| 规模 | 源文件数 | 测试数 | 映射数 | 数据库大小 |
|------|---------|--------|--------|-----------|
| 小型 | 100 | 200 | 1,000 | ~1 MB |
| 中型 | 1,000 | 2,000 | 20,000 | ~10 MB |
| 大型 | 10,000 | 20,000 | 500,000 | ~100 MB |

### 10.2 查询性能

- 文件级查询: O(log n) - 使用索引
- 符号级查询: O(log n) - 使用复合索引
- 批量插入: 使用事务批处理，100x 性能提升

---

## 11. 安全考量

1. **覆盖率服务**: 默认只监听 localhost
2. **数据库**: 本地 SQLite，无网络暴露
3. **敏感路径**: 源文件路径可能暴露项目结构，考虑相对路径

---

## 附录 A: 术语表

| 术语 | 定义 |
|------|------|
| TIA | Test Impact Analysis - 测试影响分析 |
| Coverage | 代码覆盖率 - 测试执行覆盖的代码比例 |
| Profraw | LLVM 原始覆盖率数据文件 |
| Profdata | LLVM 合并后的覆盖率数据 |
| Symbol | 代码符号 (函数/方法/类) |
| Mapping | 源文件到测试的映射关系 |
