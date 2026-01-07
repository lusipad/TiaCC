# 贡献指南

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh.md)

感谢您对 TiaCC 项目的关注！我们欢迎任何形式的贡献。

## 如何贡献

### 报告 Bug

1. 确保 Bug 尚未被报告（搜索已有的 Issues）
2. 创建新的 Issue，使用 Bug 报告模板
3. 提供详细的复现步骤和环境信息

### 提交功能请求

1. 搜索是否已有类似的功能请求
2. 创建新的 Issue，描述您期望的功能
3. 说明使用场景和预期行为

### 提交代码

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 开发环境设置

### 前置条件

- .NET SDK 10.0（版本见 global.json）
- Clang 14+ (C++ 覆盖率)
- CMake 3.20+

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/lusipad/TiaCC.git
cd TiaCC

# 构建 .NET
dotnet build src/TiaCC.DotNet.sln

# 运行测试
dotnet test src/TiaCC.DotNet.sln
```

### 运行端到端测试

```bash
cd tests/e2e/cpp-project
# Windows PowerShell
./run_e2e_test.ps1
```

## 代码规范

### C#

- 使用 EditorConfig
- 遵循 .NET 编码规范
- 所有公共 API 需要 XML 注释

```bash
dotnet format src/TiaCC.DotNet.sln
```

### C++

- 使用 clang-format
- 遵循项目 .clang-format 配置

## 提交信息格式

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

类型：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 代码重构
- `test`: 测试相关
- `chore`: 构建/工具相关

示例：
```
feat(mapper): add support for LLVM JSON format

Add LlvmJsonCoverageParser to parse pre-processed LLVM JSON files
exported via `llvm-cov export`.

Closes #123
```

## 项目结构

```
TiaCC/
├── src/                      # 源代码
│   ├── core/cpp/             # C++ 核心/覆盖率模块
│   ├── core/dotnet/          # .NET 核心库
│   ├── cli/dotnet/           # .NET CLI
│   ├── dashboard/dotnet/     # Blazor Dashboard
│   ├── collectors/           # 覆盖率采集器
│   └── clients/              # 测试框架客户端
├── scripts/                  # 仓库脚本
├── tests/
│   └── e2e/                  # 端到端测试
├── docs/                     # 文档
└── global.json               # .NET SDK 版本
```

## 添加新功能

### 添加新的覆盖率格式

1. 在 `src/core/dotnet/TiaCC.Core/Services/CoverageParser.cs` 中创建新的解析器方法
2. 实现解析逻辑
3. 在 CLI 中注册新格式
4. 添加单元测试

```csharp
public class NewFormatParser
{
    public CoverageData Parse(string coverageFile)
    {
        // 实现解析逻辑
    }
}
```

### 添加新的测试框架客户端

1. 在 `src/clients/` 目录创建新语言的客户端
2. 实现覆盖率收集接口
3. 提供 `beforeTest/afterTest` 钩子
4. 添加使用文档

## 版本发布

遵循 [Semantic Versioning](https://semver.org/)：

- **MAJOR**: 不兼容的 API 更改
- **MINOR**: 向后兼容的功能添加
- **PATCH**: 向后兼容的 Bug 修复

## 联系方式

如有问题，请通过以下方式联系：

- Issues: GitHub Issues
- 邮件: [maintainer@example.com]

再次感谢您的贡献！
