# Language-specific integration examples

[English](language-specific-examples.md) | [简体中文](language-specific-examples.zh.md)

This document provides integration examples for multiple languages/frameworks. The Chinese version contains more detailed walkthroughs: `docs/language-specific-examples.zh.md`.

> Quick start: `QUICK_START.md`

## .NET / C#

1. Run tests with coverage
2. Ingest coverage into `impact_map.db` via `tia-mapper map`
3. Use `tia-mapper recommend` on PRs

## C++ (LLVM)

1. Build with `-fprofile-instr-generate -fcoverage-mapping`
2. Run tests and produce `.profraw`
3. Export coverage via `llvm-cov export` and ingest via TiaCC

## Other languages

TiaCC can work with any coverage format you can convert into a supported input (e.g. Cobertura XML). See the Chinese version for more examples and templates.
