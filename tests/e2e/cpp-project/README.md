# TiaCC C++ End-to-end Project

[English](README.md) | [简体中文](README.zh.md)

This is a complete C++ project used to validate TiaCC’s end-to-end workflow with LLVM/Clang coverage.

## Project structure

```
cpp-project/
├── src/                      # C++ source
├── tests/                    # C++ tests
├── CMakeLists.txt
└── run_e2e_test.ps1          # end-to-end runner (Windows PowerShell)
```

## What it validates

1. Build with `-fprofile-instr-generate -fcoverage-mapping`
2. Run tests and produce `.profraw`
3. Convert to coverage JSON via `llvm-profdata` + `llvm-cov export`
4. Build mapping DB via `tia-mapper map`
5. Validate recommendations via `tia-mapper recommend`

## Run

```powershell
./run_e2e_test.ps1
```
