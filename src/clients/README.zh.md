# TiaCC 测试框架 Hooks

[English](README.md) | [简体中文](README.zh.md)

本目录包含多种语言的测试框架 Hook（钩子）实现，用于在测试执行期间采集每个测试的覆盖率数据，从而让 TiaCC 构建“代码 ↔ 测试”的影响关系映射。

## 概述

Hook 通常是你需要集成到测试框架（pytest、go test 等）里的代码片段，用来记录每个测试执行时覆盖到的文件/行信息。

## 已提供的 Hooks

| 语言 | 文件 | 常见测试框架 |
|------|------|--------------|
| **C#/.NET** | `TiaHooks.cs` | xUnit, NUnit, MSTest |
| **Python** | `tia_hooks.py` | pytest, unittest |
| **Go** | `tia_hooks.go` | go test |
| **Lua** | `tia_hooks.lua` | busted, luaunit |

## 使用方式（概览）

1. 选择与你语言匹配的 Hook 文件
2. 按文件顶部注释的说明集成到测试生命周期（before/after）
3. 运行测试并产出覆盖率数据
4. 用 `tia-mapper map` 导入覆盖率构建映射库
