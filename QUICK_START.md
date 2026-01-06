# TiaCC 快速集成指南

> 5 分钟快速接入 TiaCC 测试影响分析系统

## 安装

```bash
# 确保已安装 .NET 10 SDK（版本见 global.json）
dotnet --version

# 克隆仓库
git clone https://github.com/lusipad/TiaCC.git
cd TiaCC

# 构建
dotnet build src/TiaCC.DotNet.sln -c Release
```

---

## 快速开始：3 步集成

### 第 1 步：生成覆盖率数据

**C# 项目**：
```bash
dotnet test --collect:"XPlat Code Coverage" --results-directory ./coverage
```

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

### 第 2 步：构建映射数据库

```bash
# 初始化数据库
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- init --db impact_map.db

# 映射覆盖率数据
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- map \
  --db impact_map.db \
  --coverage ../coverage/*/coverage.cobertura.xml \
  --test MyTestClass
```

### 第 3 步：获取受影响的测试

```bash
# 查询受影响的测试
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
  --db impact_map.db \
  --files src/MyService.cs

# 查看统计信息
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- stats --db impact_map.db
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

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          global-json-file: global.json
          include-prerelease: true

      - name: Download impact map
        uses: dawidd6/action-download-artifact@v3
        with:
          workflow: nightly.yml
          name: impact-map

      - name: Build TiaCC
        run: dotnet build src/TiaCC.DotNet.sln -c Release

      - name: Get affected tests
        run: |
          CHANGED_FILES=$(git diff --name-only origin/main)
          dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
            --db impact_map.db \
            --files $CHANGED_FILES \
            > affected_tests.txt
          echo "Running $(wc -l < affected_tests.txt) affected tests..."

      - name: Run affected tests
        run: |
          FILTER=$(cat affected_tests.txt | tr '\n' '|' | sed 's/|$//')
          dotnet test --filter "FullyQualifiedName~$FILTER"
```

### GitLab CI

```yaml
smart-test:
  stage: test
  script:
    - dotnet build src/TiaCC.DotNet.sln -c Release
    - CHANGED_FILES=$(git diff --name-only origin/main)
    - dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query --db impact_map.db --files $CHANGED_FILES > tests.txt
    - FILTER=$(cat tests.txt | tr '\n' '|' | sed 's/|$//')
    - dotnet test --filter "FullyQualifiedName~$FILTER"
  only:
    - merge_requests
```

---

## 常用命令速查

### 基础命令

| 命令 | 说明 |
|------|------|
| `tiacc init` | 初始化映射数据库 |
| `tiacc map` | 从覆盖率数据添加映射 |
| `tiacc stats` | 查看数据库统计信息 |
| `tiacc query <files>` | 查询某文件被哪些测试覆盖 |
| `tiacc export` | 导出数据用于 Dashboard 可视化 |

### 完整参数

#### init 命令

```bash
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- init \
  --db <path>                   # 数据库路径（必需）
```

#### map 命令

```bash
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- map \
  --db <path>                   # 数据库路径（必需）
  --coverage <path>             # 覆盖率文件路径（必需）
  --test <name>                 # 测试名称（必需）
  [--base-dir <path>]           # 基准路径，用于规范化文件路径
```

#### query 命令

```bash
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
  --db <path>                   # 数据库路径（必需）
  --files <files...>            # 要查询的文件列表（必需）
```

#### stats 命令

```bash
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- stats \
  --db <path>                   # 数据库路径（必需）
```

---

## 下一步

- [完整文档](docs/architecture.md)
- [详细集成指南](docs/integration-guide.md)
- [Dashboard 使用](docs/dashboard.md)
- [E2E 测试示例](tests/e2e/README.md)

---

## 获取帮助

```bash
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- --help
```

有问题？请提交 [Issue](https://github.com/lusipad/TiaCC/issues)
