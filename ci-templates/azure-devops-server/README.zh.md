# TiaCC Azure DevOps Server 集成

[English](README.md) | [简体中文](README.zh.md)

本目录提供 Azure DevOps Server（原 TFS）集成所需的模板与脚本。

## 文件

| 文件 | 说明 |
|------|------|
| `tiacc-pipeline.yml` | Azure DevOps Server 2019+ 的 YAML 模板 |
| `tiacc-build.ps1` | 构建/更新映射数据库的 PowerShell 脚本 |
| `tiacc-recommend.ps1` | 推荐受影响测试的 PowerShell 脚本 |

## 前置条件

- Azure DevOps Server 2019 或更高版本
- 构建代理安装 Git
- 构建代理可运行 `tia-mapper`（推荐：下载自包含 release 可执行文件，或安装 .NET 全局工具 `TiaCC.Cli`）

## 排错

```powershell
git --version
tia-mapper --version
```
