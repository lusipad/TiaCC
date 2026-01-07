# TiaCC Architecture

[English](architecture.md) | [简体中文](architecture.zh.md)

This document gives an overview of TiaCC’s architecture. The Chinese version contains more detailed diagrams and analysis: `docs/architecture.zh.md`.

## What TiaCC does

TiaCC builds a **mapping from code → tests** using coverage data, so when code changes you can run only the tests that are impacted.

## Main components

- **CLI (`tia-mapper`)**: builds/query/exports the mapping database.
- **Core libraries**:
  - C++ core (coverage/LLVM integration) under `src/core/cpp/`
  - .NET core (database, parsers, export) under `src/core/dotnet/`
- **Collectors**: per-test coverage collectors (e.g. Coverlet) under `src/collectors/`
- **Dashboard (Blazor)**: visualization under `src/dashboard/dotnet/TiaCC.Dashboard/`

## Data flow (high level)

1. Collect coverage per test (format depends on language/toolchain)
2. Parse coverage into normalized source-file paths and executed lines
3. Upsert mappings into SQLite (`impact_map.db`)
4. On PR/commit, compute changed files and recommend impacted tests
5. Export JSON (`tia-mapper export`) for the Dashboard

## Key commands

```bash
tia-mapper init --db impact_map.db
tia-mapper map --db impact_map.db --coverage coverage.cobertura.xml --test MyTest
tia-mapper query --db impact_map.db --files src/MyFile.cs
tia-mapper recommend --db impact_map.db --base origin/main --head HEAD
tia-mapper export --db impact_map.db --output ./artifacts/tiacc-data/dashboard
```

## Related docs

- Integration guide: `docs/integration-guide.md`
- CI/CD guide: `docs/ci-cd-integration.md`
- Dashboard: `docs/dashboard.md`
