# TiaCC .NET 工具

[English](dotnet.md) | [简体中文](dotnet.zh.md)

TiaCC（基于代码覆盖率的测试影响分析）的 .NET 版本实现，包含 CLI 工具与 Web Dashboard。

## 环境要求

- .NET 10 SDK（版本见 `global.json`）
- SQLite（通过 EF Core 依赖自动引入）

## 构建

```bash
dotnet build src/TiaCC.DotNet.sln
```

## 安装为全局工具

```bash
dotnet pack src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj
dotnet tool install --global --add-source ./src/cli/dotnet/TiaCC.Cli/nupkg TiaCC.Cli
```

安装后使用命令 `tia-mapper`：

```bash
tia-mapper --help
```

## 常用命令

### 初始化数据库

```bash
tia-mapper init --db impact_map.db
```

### 添加映射（从覆盖率）

```bash
tia-mapper map --db impact_map.db --coverage ./coverage/coverage.cobertura.xml --test MyTest
```

### 基于 Git 变更推荐测试

```bash
tia-mapper recommend --db impact_map.db --base origin/main --head HEAD
```

### 查询

```bash
tia-mapper query --db impact_map.db --files src/MyFile.cs
```

### 导出（用于 Dashboard）

```bash
tia-mapper export --db impact_map.db --output ./artifacts/tiacc-data/dashboard
```
