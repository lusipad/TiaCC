# Dashboard (Blazor)

TiaCC Dashboard 是一个 Blazor WebAssembly 应用，用于可视化测试影响关系与覆盖率数据。

## 启动

```bash
dotnet run --project src/dashboard/dotnet/TiaCC.Dashboard/TiaCC.Dashboard.csproj -c Release
```

## 导出数据

Dashboard 默认从 `src/dashboard/dotnet/TiaCC.Dashboard/wwwroot/data/` 读取导出的 JSON 数据。

```bash
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- export \
  --db impact_map.db \
  --output src/dashboard/dotnet/TiaCC.Dashboard/wwwroot/data
```
