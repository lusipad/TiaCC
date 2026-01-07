# Dashboard (Blazor)

[English](dashboard.md) | [简体中文](dashboard.zh.md)

TiaCC Dashboard 是一个 Blazor WebAssembly 应用，用于可视化测试影响关系与覆盖率数据。

## 启动

```bash
dotnet run --project src/dashboard/dotnet/TiaCC.Dashboard/TiaCC.Dashboard.csproj -c Release
```

## 导出数据

Dashboard 会从 `src/dashboard/dotnet/TiaCC.Dashboard/wwwroot/data/` 读取导出的 JSON 数据（例如 `data/dashboard.json`）。

`tia-mapper export` 默认输出目录是 `./artifacts/tiacc-data/dashboard`。如果你要在 Dashboard 中直接查看导出的数据，可以：

1. 用 `--output` 直接导出到 Dashboard 的 `wwwroot/data/`
2. 或导出到默认目录后，将生成的 JSON 复制到 `wwwroot/data/`

```bash
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- export \
  --db impact_map.db \
  --output src/dashboard/dotnet/TiaCC.Dashboard/wwwroot/data
```
