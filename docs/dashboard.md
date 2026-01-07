# Dashboard (Blazor)

[English](dashboard.md) | [简体中文](dashboard.zh.md)

TiaCC Dashboard is a Blazor WebAssembly app for visualizing test impact and coverage data.

## Run

```bash
dotnet run --project src/dashboard/dotnet/TiaCC.Dashboard/TiaCC.Dashboard.csproj -c Release
```

## Export data

The Dashboard loads JSON from `src/dashboard/dotnet/TiaCC.Dashboard/wwwroot/data/` (for example `data/dashboard.json`).

`tia-mapper export` defaults to `./artifacts/tiacc-data/dashboard`. To view exported data in the Dashboard you can either:

1. Export directly into the Dashboard web root via `--output`, or
2. Export to the default folder and then copy the generated JSON into `wwwroot/data/`.

```bash
dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- export \
  --db impact_map.db \
  --output src/dashboard/dotnet/TiaCC.Dashboard/wwwroot/data
```
