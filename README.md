# TiaCC - Test Impact Analysis for Code Coverage

跨平台测试影响分析系统，通过代码覆盖率分析将代码变更映射到受影响的测试。

## 功能特性

- **多语言支持**: C++ (LLVM Profile) 和 C# (coverlet)
- **跨平台**: Windows, Linux, macOS
- **灵活的录制模式**:
  - 精确模式 (Precise): 每个测试单独录制，1:1 精确映射
  - 批量模式 (Bucket): 测试分组录制，减少 IO 开销
- **Lua 测试框架集成**: 通过 IPC 与测试框架无缝集成
- **Git 集成**: 自动检测变更文件并推荐测试

## 项目结构

```
TiaCC/
├── src/
│   ├── cpp/                  # C++ 覆盖率采集模块
│   └── dotnet/               # C# 覆盖率采集模块
├── tools-node/               # Node.js/TypeScript CLI 工具
│   ├── src/cli/mapper.ts     # 映射生成器
│   └── src/cli/recommend.ts  # 变更推荐器
├── lua/                      # Lua 测试框架集成
└── tests/                    # 单元测试
```

## 快速开始

### 1. 构建 C++ 模块

```bash
# 使用 Clang 编译器
mkdir build && cd build
cmake .. -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++
cmake --build .
```

### 2. 构建 .NET 模块

```bash
cd src/dotnet
dotnet build
```

### 3. 安装工具

```bash
cd tools-node
npm install
npm run build
```

### 4. 运行覆盖率服务

```bash
# C++ 服务
./build/bin/tia_coverage_service --port 19840

# .NET 服务
dotnet run --project src/dotnet/TiaCC.CoverageService -- --port 19841
```

### 5. 集成到 Lua 测试框架

```lua
local TiaHooks = require("tia_hooks")

TiaHooks:init({
    host = "127.0.0.1",
    port = 19840,
    mode = "precise"
})

-- 运行测试
TiaHooks:beforeTest("test_001")
-- ... 执行测试 ...
TiaHooks:afterTest("test_001")
```

### 6. 构建映射数据库

```bash
npx tia-mapper build --coverage-dir ./coverage_data --db impact_map.db
```

### 7. 推荐受影响的测试

```bash
npx tia-recommend --db impact_map.db --branch origin/main
```

## 配置

编辑 `tia_config.json`:

```json
{
    "recording_mode": "precise",
    "bucket_size": 50,
    "output_dir": "./coverage_data"
}
```

## CI 集成示例

### GitHub Actions

```yaml
- name: Get affected tests
  run: |
    python tools/tia_recommend.py \
      --db impact_map.db \
      --branch origin/main \
      --output tests_to_run.txt

- name: Run affected tests
  run: |
    while read test; do
      lua "$test"
    done < tests_to_run.txt
```

## 依赖

### C++
- CMake 3.20+
- Clang 14+ (带 Profile Runtime)
- nlohmann/json
- asio

### C#
- .NET SDK 6.0+
- coverlet.collector

### Python
- Python 3.10+
- click
- tqdm
- GitPython

## 许可证

MIT License
