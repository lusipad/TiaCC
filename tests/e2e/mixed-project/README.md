# TiaCC Mixed-language End-to-end Project

[English](README.md) | [简体中文](README.zh.md)

This project demonstrates test impact analysis for a mixed setup: a C# executable calling a C++ native library via P/Invoke.

## Structure

```
mixed-project/
├── native/                   # C++ library
├── managed/                  # C# app + xUnit tests
├── coverage_data/            # outputs
└── run_e2e_test.cmd          # runner script (Windows)
```

## Requirements

- .NET SDK (see `global.json`)
- CMake + a C++ compiler toolchain

## What it validates

- Mapping and recommendations across language boundaries (C# ↔ C++)
