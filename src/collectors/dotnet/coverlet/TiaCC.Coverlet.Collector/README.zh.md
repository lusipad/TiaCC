# TiaCC.Coverlet.Collector

[English](README.md) | [简体中文](README.zh.md)

> 面向 .NET 的“按测试粒度”覆盖率采集器，用于测试影响分析（TiaCC）

## 概述

该包提供一个 VSTest Data Collector，与 Coverlet 协作，在每个测试方法维度采集覆盖率数据，从而让 TiaCC 构建更精确的测试影响映射。

## 安装

```bash
dotnet add package TiaCC.Coverlet.Collector
```

或在测试项目的 `.csproj` 中添加：

```xml
<PackageReference Include="TiaCC.Coverlet.Collector" Version="1.0.0" />
```

## 使用

### 基础用法

```bash
dotnet test --collect:"TiaCC Coverage"
```

覆盖率文件默认写入 `.tiacc/coverage/`。

### 自定义输出目录

创建一个 `.runsettings`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<RunSettings>
  <DataCollectionRunSettings>
    <DataCollectors>
      <DataCollector friendlyName="TiaCC Coverage">
        <Configuration>
          <OutputDirectory>.tiacc/coverage</OutputDirectory>
        </Configuration>
      </DataCollector>
    </DataCollectors>
  </DataCollectionRunSettings>
</RunSettings>
```

然后：

```bash
dotnet test --settings:test.runsettings
```
