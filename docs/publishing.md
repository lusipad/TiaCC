# TiaCC 发布指南

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

1. ✅ **构建项目** - 使用 Release 配置构建
2. 🧪 **运行测试** - 确保所有测试通过
3. 📦 **打包 NuGet** - 生成 `.nupkg` 文件
4. 🚀 **发布到 NuGet.org** - 如果配置了 API Key
5. 📦 **发布到 GitHub Packages** - 自动发布
6. 🎉 **创建 GitHub Release** - 包含下载链接和安装说明
7. 💾 **上传构建产物** - 保留 30 天

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

### 从 NuGet.org 安装

```bash
dotnet tool install --global TiaCC.Cli
```

### 从 GitHub Packages 安装

```bash
dotnet tool install --global TiaCC.Cli \
  --add-source https://nuget.pkg.github.com/lusipad/index.json
```

### 安装特定版本

```bash
dotnet tool install --global TiaCC.Cli --version 1.0.0
```

## 验证安装

安装成功后，可以运行：

```bash
tia-mapper --help
```

## 更新工具

```bash
dotnet tool update --global TiaCC.Cli
```

## 卸载工具

```bash
dotnet tool uninstall --global TiaCC.Cli
```

## 发布前检查清单

在发布新版本前，请确保：

- [ ] 所有测试通过
- [ ] 更新了 `CHANGELOG.md`（如果有）
- [ ] 更新了 `TiaCC.Cli.csproj` 中的版本号
- [ ] 代码已合并到主分支
- [ ] 已经在本地测试过打包流程

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
