# TiaCC Integration Guide

[English](integration-guide.md) | [简体中文](integration-guide.zh.md)

This guide shows how to integrate TiaCC into an existing project.
For a deeper Chinese walkthrough (including more context and diagrams), see `docs/integration-guide.zh.md`.

## Typical workflow

1. **Collect coverage** during test execution (per-test preferred)
2. **Build/update the mapping DB** (`impact_map.db`) in a nightly/full run
3. **Recommend/query tests** on PRs/commits based on changed files
4. **Export** JSON to the Dashboard when needed

## Nightly: build the mapping DB

```bash
tia-mapper init --db impact_map.db

# Repeat for each test run / coverage file you ingest
tia-mapper map --db impact_map.db --coverage coverage.cobertura.xml --test MyTestName
```

## PR/commit: recommend impacted tests

```bash
tia-mapper recommend --db impact_map.db --base origin/main --head HEAD
```

If you already have a list of changed files (e.g. from your CI), you can query directly:

```bash
tia-mapper query --db impact_map.db --files src/MyFile.cs src/OtherFile.cs
```

## Dashboard export

See `docs/dashboard.md`.
