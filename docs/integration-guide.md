# TiaCC 集成指南

## 概述

将 TiaCC 集成到现有项目需要以下步骤：

```
┌─────────────────────────────────────────────────────────────┐
│                      你的游戏引擎项目                         │
├─────────────────────────────────────────────────────────────┤
│  1. C++/C# 代码 ──编译时插桩──> 带覆盖率的可执行文件          │
│  2. Lua 测试框架 ──IPC──> TiaCC 覆盖率服务                   │
│  3. 测试运行 ──生成──> .profraw / .coverage.json            │
│  4. Nightly CI ──映射生成──> impact_map.db                  │
│  5. PR/提交时 ──推荐──> 受影响的测试列表                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 第一步：编译时集成 (C++)

### 方式 A：作为子项目引入

```cmake
# 你的项目 CMakeLists.txt

# 添加 TiaCC 作为子目录
add_subdirectory(third_party/TiaCC/src/cpp)

# 链接到你的可执行文件
target_link_libraries(your_game_engine
    PRIVATE
        tia_coverage   # 覆盖率 API
)
```

### 方式 B：仅使用编译标志

如果不想引入 TiaCC 库，只需添加编译标志：

```cmake
# 仅在 Coverage 构建配置中启用
if(ENABLE_COVERAGE)
    target_compile_options(your_game_engine PRIVATE
        -fprofile-instr-generate
        -fcoverage-mapping
    )
    target_link_options(your_game_engine PRIVATE
        -fprofile-instr-generate
    )
endif()
```

### 编译器要求

| 平台 | 编译器 | 安装方式 |
|------|--------|----------|
| Windows | Clang-cl | VS Installer → "C++ Clang tools" |
| Linux | Clang 14+ | `apt install clang` |
| macOS | Apple Clang | Xcode Command Line Tools |

---

## 第二步：编译时集成 (C#)

### 添加 coverlet 包

```xml
<!-- 你的 .csproj 文件 -->
<ItemGroup>
    <PackageReference Include="coverlet.collector" Version="6.0.0" />
</ItemGroup>
```

### 或使用 TiaCC.Coverage 库

```xml
<ItemGroup>
    <ProjectReference Include="path/to/TiaCC.Coverage/TiaCC.Coverage.csproj" />
</ItemGroup>
```

---

## 第三步：Lua 测试框架集成

### 3.1 复制 Lua 钩子文件

```bash
cp TiaCC/lua/tia_hooks.lua your_project/scripts/
```

### 3.2 修改你的测试运行器

**修改前：**
```lua
-- your_test_runner.lua
function runAllTests()
    for _, test in ipairs(testList) do
        local success = pcall(test.func)
        recordResult(test.name, success)
    end
end
```

**修改后：**
```lua
-- your_test_runner.lua
local TiaHooks = require("tia_hooks")

-- 初始化连接（测试开始前调用一次）
function initCoverage()
    TiaHooks:init({
        host = "127.0.0.1",
        port = 19840,           -- C++ 服务端口
        mode = "precise",       -- 或 "bucket"
        bucketSize = 50,
        language = "cpp",       -- 或 "csharp"
        debug = false
    })
end

-- 修改测试运行函数
function runAllTests()
    initCoverage()

    for _, test in ipairs(testList) do
        -- 测试前：开始记录
        TiaHooks:beforeTest(test.name)

        local success = pcall(test.func)
        recordResult(test.name, success)

        -- 测试后：停止并保存
        TiaHooks:afterTest(test.name)
    end

    -- 如果使用 bucket 模式，确保刷新最后一个桶
    TiaHooks:flushBucket()
    TiaHooks:disconnect()
end
```

### 3.3 批量模式示例（5000+ 测试推荐）

```lua
local TiaHooks = require("tia_hooks")

TiaHooks:init({
    mode = "bucket",
    bucketSize = 100,  -- 每 100 个测试生成一个覆盖率文件
})

for i, test in ipairs(testList) do
    TiaHooks:beforeTest(test.name)
    pcall(test.func)
    TiaHooks:afterTest(test.name)

    -- 进度提示
    if i % 500 == 0 then
        print(string.format("Progress: %d/%d", i, #testList))
    end
end

TiaHooks:flushBucket()
```

---

## 第四步：启动覆盖率服务

### 方式 A：作为独立进程

```bash
# 启动 C++ 覆盖率服务
./tia-coverage-service --port 19840

# 或启动 C# 覆盖率服务
dotnet run --project TiaCC.CoverageService -- --port 19841
```

### 方式 B：嵌入到你的应用中

```cpp
// 在你的游戏引擎初始化代码中
#include <tia/ipc_server.h>

int main() {
    // 启动覆盖率服务（后台线程）
    tia::IpcServer server({.port = 19840});
    server.startAsync();

    // 你的正常初始化代码...
    initGameEngine();

    // 运行主循环
    runMainLoop();

    server.stop();
    return 0;
}
```

---

## 第五步：CI/CD 集成

### 5.1 Nightly 构建：生成映射数据库

```yaml
# .github/workflows/nightly-coverage.yml
name: Nightly Coverage Map

on:
  schedule:
    - cron: '0 2 * * *'  # 每天凌晨 2 点

jobs:
  build-coverage-map:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build with coverage
        run: |
          cmake --preset linux-clang-coverage
          cmake --build build/linux-clang-coverage

      - name: Run all tests with coverage
        run: |
          ./build/bin/tia-coverage-service &
          sleep 2
          lua scripts/run_all_tests.lua
          kill %1

      - name: Build impact map
        run: |
          cd TiaCC/tools-node
          npm install
          npx tia-mapper build \
            --coverage-dir ../coverage_data \
            --db ../impact_map.db \
            --executable ../build/bin/your_game_engine

      - name: Upload impact map
        uses: actions/upload-artifact@v4
        with:
          name: impact-map
          path: impact_map.db
          retention-days: 30
```

### 5.2 PR 检查：只运行受影响的测试

```yaml
# .github/workflows/pr-check.yml
name: PR Test Selection

on:
  pull_request:
    branches: [main, develop]

jobs:
  smart-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 需要完整历史来计算 diff

      - name: Download impact map
        uses: dawidd6/action-download-artifact@v3
        with:
          workflow: nightly-coverage.yml
          name: impact-map

      - name: Get affected tests
        id: affected
        run: |
          cd TiaCC/tools-node
          npm install
          npx tia-recommend \
            --db ../../impact_map.db \
            --branch origin/main \
            --output ../../affected_tests.txt \
            --quiet

          TEST_COUNT=$(wc -l < ../../affected_tests.txt)
          echo "count=$TEST_COUNT" >> $GITHUB_OUTPUT

      - name: Run affected tests
        if: steps.affected.outputs.count > 0
        run: |
          echo "Running ${{ steps.affected.outputs.count }} affected tests..."
          while read test; do
            lua "$test"
          done < affected_tests.txt

      - name: Skip tests (no changes)
        if: steps.affected.outputs.count == 0
        run: echo "No tests affected by this PR!"
```

---

## 第六步：本地开发工作流

### 安装 TiaCC 工具

```bash
# 全局安装 CLI 工具
cd TiaCC/tools-node
npm install
npm link  # 创建全局命令
```

### 日常使用

```bash
# 查看当前改动影响哪些测试
tia-recommend --branch origin/main

# 只运行受影响的测试
tia-recommend --branch origin/main --output tests.txt
cat tests.txt | xargs -I {} lua {}

# 查看数据库统计
tia-mapper stats --db impact_map.db

# 查询某个文件被哪些测试覆盖
tia-mapper query src/engine/physics.cpp
```

---

## 完整集成检查清单

- [ ] **编译配置**
  - [ ] C++: 添加 Clang 编译标志
  - [ ] C#: 添加 coverlet 包

- [ ] **运行时集成**
  - [ ] Lua 测试框架引入 `tia_hooks.lua`
  - [ ] 测试运行器调用 `beforeTest/afterTest`

- [ ] **覆盖率服务**
  - [ ] 编译 `tia-coverage-service`
  - [ ] 配置服务启动方式

- [ ] **工具安装**
  - [ ] 安装 Node.js 18+
  - [ ] 安装 TiaCC tools-node 依赖

- [ ] **CI/CD**
  - [ ] Nightly: 运行全量测试生成映射
  - [ ] PR: 下载映射并推荐测试

- [ ] **本地开发**
  - [ ] 配置 `tia-recommend` 命令
  - [ ] (可选) Git pre-push hook

---

## 常见问题

### Q: 覆盖率服务连接失败？

```lua
-- 检查服务是否运行
TiaHooks:init({ debug = true })  -- 启用调试输出

-- 检查端口
netstat -an | grep 19840
```

### Q: 映射数据库太大？

```bash
# 清理旧的覆盖率数据
rm -rf coverage_data/*.profraw

# 使用 bucket 模式减少文件数量
# 将 bucketSize 从 50 增加到 100
```

### Q: 推荐的测试太多？

使用 bucket 模式时，一个源文件变更会触发整个桶的测试。解决方案：

1. 减小 bucketSize（更精确但更多 IO）
2. 将关键模块的测试放在单独的桶中
3. 按模块分组运行测试

### Q: 新文件没有被追踪？

新文件需要在 Nightly 构建后才会出现在映射中。手动触发：

```bash
# 重新运行映射生成
tia-mapper build --coverage-dir ./coverage_data --db impact_map.db
```
