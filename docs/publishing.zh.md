# TiaCC 发布指南

[English](publishing.md) | [简体中文](publishing.zh.md)

本文档说明如何使用 GitHub Actions 自动发布 TiaCC 工具。

## 发布方式

TiaCC 支持两种发布方式：

### 1. 通过 Git 标签自动发布（推荐）

创建并推送版本标签时，会自动触发发布流程：

```bash
# 1. 确保代码已提交
git add .
git commit -m "准备发布 v1.0.0"

# 2. 创建版本标签
git tag v1.0.0

# 3. 推送标签到远程仓库
git push origin v1.0.0
```

### 2. 手动触发发布

在 GitHub 仓库页面：
1. 进入 **Actions** 标签页
2. 选择 **Publish TiaCC** 工作流
3. 点击 **Run workflow**
4. 输入版本号（如 `1.0.0`）
5. 点击 **Run workflow** 按钮

## 发布流程

发布工作流会自动执行以下步骤：

### Job 1: 测试和打包 NuGet
1. ✅ **构建项目** - 使用 Release 配置构建
2. 🧪 **运行测试** - 确保所有测试通过
3. 📦 **打包 NuGet** - 生成 `.nupkg` 文件
4. 💾 **上传 NuGet 包** - 作为构建产物

### Job 2: 构建多平台可执行程序

并行构建 5 个平台的独立可执行程序：
- **Windows x64** - `tiacc-win-x64.zip`
- **Linux x64** - `tiacc-linux-x64.tar.gz`
- **Linux ARM64** - `tiacc-linux-arm64.tar.gz`
- **macOS Intel** - `tiacc-osx-x64.tar.gz`
- **macOS Apple Silicon** - `tiacc-osx-arm64.tar.gz`

每个可执行程序都是自包含的（self-contained），包含了 .NET 运行时，用户无需安装 .NET SDK。

### Job 3: 发布

1. 🚀 **发布到 NuGet.org** - 如果配置了 API Key
2. 📦 **发布到 GitHub Packages** - 自动发布
3. 🎉 **创建 GitHub Release** - 包含所有可执行程序和 NuGet 包
4. 💾 **所有构建产物** - 保留 7 天

## 配置要求

### 发布到 NuGet.org（可选）

如果要发布到 NuGet.org，需要配置 API Key：

1. 在 [NuGet.org](https://www.nuget.org/) 创建账号
2. 生成 API Key
3. 在 GitHub 仓库设置中添加 Secret：
   - 名称：`NUGET_API_KEY`
   - 值：你的 NuGet API Key

如果未配置，工作流会跳过 NuGet.org 发布步骤，但仍会发布到 GitHub Packages。

### 发布到 GitHub Packages

GitHub Packages 发布使用内置的 `GITHUB_TOKEN`，无需额外配置。

## 版本号规范

建议使用[语义化版本](https://semver.org/lang/zh-CN/)：

- **主版本号**：不兼容的 API 修改
- **次版本号**：向下兼容的功能性新增
- **修订号**：向下兼容的问题修正

示例：
- `v1.0.0` - 首个正式版本
- `v1.1.0` - 新增功能
- `v1.1.1` - 修复 bug
- `v2.0.0` - 重大更新

## 安装已发布的包

### 方式 1：独立可执行程序（推荐，无需 .NET SDK）

从 [GitHub Releases](https://github.com/lusipad/TiaCC/releases) 页面下载适合你操作系统的压缩包：

#### Windows
```powershell
# 下载并解压 tiacc-win-x64.zip
# 然后运行
.\tia-mapper.exe --help
```

#### Linux
```bash
# 下载 tiacc-linux-x64.tar.gz
tar -xzf tiacc-linux-x64.tar.gz
chmod +x tia-mapper
./tia-mapper --help

# 可选：移动到系统路径
sudo mv tia-mapper /usr/local/bin/
```

#### macOS
```bash
# 下载对应版本：
# Intel Mac: tiacc-osx-x64.tar.gz
# Apple Silicon: tiacc-osx-arm64.tar.gz
tar -xzf tiacc-osx-arm64.tar.gz
chmod +x tia-mapper
./tia-mapper --help

# 可选：移动到系统路径
sudo mv tia-mapper /usr/local/bin/
```

### 方式 2：.NET Global Tool（需要 .NET SDK）

#### 从 NuGet.org 安装

```bash
dotnet tool install --global TiaCC.Cli
```

#### 从 GitHub Packages 安装

```bash
dotnet tool install --global TiaCC.Cli \
  --add-source https://nuget.pkg.github.com/lusipad/index.json
```

#### 安装特定版本

```bash
dotnet tool install --global TiaCC.Cli --version 1.0.0
```

## 验证安装

安装成功后，可以运行：

```bash
tia-mapper --help
tia-mapper --version
```

## 更新工具

### 更新可执行程序
重新下载最新版本的压缩包并替换旧文件。

### 更新 .NET Global Tool
```bash
dotnet tool update --global TiaCC.Cli
```

## 卸载工具

### 删除可执行程序
直接删除可执行文件即可。

### 卸载 .NET Global Tool
```bash
dotnet tool uninstall --global TiaCC.Cli
```

## 平台支持

发布的可执行程序支持以下平台：

| 平台 | 架构 | 文件名 | 大小（约） |
|------|------|--------|-----------|
| Windows | x64 | `tiacc-win-x64.zip` | ~60 MB |
| Linux | x64 | `tiacc-linux-x64.tar.gz` | ~50 MB |
| Linux | ARM64 | `tiacc-linux-arm64.tar.gz` | ~50 MB |
| macOS | Intel (x64) | `tiacc-osx-x64.tar.gz` | ~50 MB |
| macOS | Apple Silicon (ARM64) | `tiacc-osx-arm64.tar.gz` | ~50 MB |

所有可执行程序都是：
- ✅ **自包含** - 包含 .NET 运行时，无需安装 .NET SDK
- ✅ **单文件** - 整个应用打包成一个可执行文件
- ✅ **稳定** - 默认关闭 PublishTrimmed，避免裁剪导致的运行时问题
- ✅ **可移植** - 可以复制到任何位置运行

## 发布前检查清单

在发布新版本前，请确保：

- [ ] 所有测试通过
- [ ] 更新了 `CHANGELOG.md`（如果有）
- [ ] 更新了 `TiaCC.Cli.csproj` 中的版本号
- [ ] 代码已合并到主分支
- [ ] 已经在本地测试过打包流程
- [ ] 确认支持的平台列表是否需要更新

## 故障排除

### 发布失败

如果发布失败，检查：

1. **测试失败** - 查看测试日志
2. **NuGet.org API Key** - 确认 Secret 配置正确
3. **版本冲突** - 该版本号是否已存在
4. **网络问题** - 重新运行工作流

### 包已存在

如果提示包已存在，需要：
- 使用新的版本号
- 或者删除已发布的版本（不推荐）

## 相关链接

- [NuGet.org 包管理](https://www.nuget.org/packages/TiaCC.Cli)
- [GitHub Releases](https://github.com/lusipad/TiaCC/releases)
- [GitHub Actions 工作流](.github/workflows/publish.yml)
