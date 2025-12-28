# 📦 TiaCC npm 发布指南

## 当前状态

❌ **未发布** - `@tiacc/tools` 尚未发布到 npm registry

✅ **已配置** - package.json 配置完整，可以随时发布

## 🚀 发布步骤

### 前置要求

1. **npm 账号**
   - 在 https://www.npmjs.com/ 注册账号
   - 验证邮箱

2. **组织权限** (如果使用 @tiacc scope)
   - 选项 A: 在 npm 创建 `@tiacc` 组织
   - 选项 B: 改为无 scope 的包名 (如 `tiacc-tools`)

3. **权限检查**
   ```bash
   # 检查是否有发布权限
   npm access list packages
   ```

### 步骤 1️⃣: 准备发布

```bash
cd /home/user/TiaCC/tools-node

# 确保在正确的分支
git checkout main
git pull origin main

# 清理并重新安装依赖
rm -rf node_modules package-lock.json
npm install

# 运行测试
npm test

# 构建项目
npm run build

# 检查构建产物
ls -la dist/
```

### 步骤 2️⃣: 版本管理

```bash
# 查看当前版本
npm version

# 更新版本号 (根据语义化版本)
npm version patch   # 1.0.0 -> 1.0.1 (bug 修复)
npm version minor   # 1.0.0 -> 1.1.0 (新功能)
npm version major   # 1.0.0 -> 2.0.0 (重大变更)

# 或手动编辑 package.json 中的 version 字段
```

### 步骤 3️⃣: 登录 npm

```bash
# 登录 npm
npm login

# 输入:
# - Username
# - Password
# - Email
# - OTP (如果启用了 2FA)

# 验证登录状态
npm whoami
```

### 步骤 4️⃣: 发布

```bash
# 干运行 (dry-run) - 查看会发布什么文件
npm publish --dry-run

# 正式发布
npm publish --access public

# 如果遇到 scope 问题，考虑改包名
# 在 package.json 中将 "@tiacc/tools" 改为 "tiacc-tools"
```

### 步骤 5️⃣: 验证发布

```bash
# 查看包信息
npm view @tiacc/tools

# 在新目录测试安装
mkdir /tmp/test-install
cd /tmp/test-install
npm install -g @tiacc/tools

# 测试命令
tia-mapper --version
tia-recommend --help
```

### 步骤 6️⃣: 更新文档

发布成功后，更新以下文件中的安装说明：

- ✅ README.md
- ✅ QUICKSTART.md
- ✅ tools-node/docs/DOGFOODING.md

将 `npm install @tiacc/tools` 改为官方安装方式。

## 📋 发布前检查清单

- [ ] ✅ 所有测试通过 (`npm test`)
- [ ] ✅ 代码已构建 (`npm run build`)
- [ ] ✅ package.json 信息完整
  - [x] name: "@tiacc/tools"
  - [x] version: "1.0.0"
  - [x] description
  - [x] keywords
  - [x] repository (已更新为 lusipad/TiaCC)
  - [x] homepage
  - [x] license: MIT
- [ ] ✅ README.md 完整
- [ ] ✅ LICENSE 文件存在
- [ ] ✅ .npmignore 或 package.json files 字段配置正确
- [ ] ✅ 已登录 npm (`npm whoami`)
- [ ] ✅ 版本号已更新

## 🔄 发布后的工作

### 1. Git 标签

```bash
# 创建版本标签
git tag v1.0.0
git push origin v1.0.0

# 或使用 npm version 自动创建标签
npm version patch -m "Release v%s"
git push --follow-tags
```

### 2. GitHub Release

在 GitHub 上创建 Release:
- 访问 https://github.com/lusipad/TiaCC/releases/new
- 选择刚创建的 tag
- 填写 Release notes
- 发布

### 3. 更新文档

将所有文档中的安装方式从 git 改为 npm:

**之前**:
```bash
npm install -g git+https://github.com/lusipad/TiaCC.git#main:tools-node
```

**之后**:
```bash
npm install -g @tiacc/tools
```

### 4. 宣传

- 在项目 README 中添加 npm 徽章
- 发布到社交媒体
- 更新相关文档和教程

## 🔧 常见问题

### Q: 如何修改包名？

如果无法使用 `@tiacc` scope，可以改为无 scope 的名字：

```json
{
  "name": "tiacc-tools",  // 改这里
  "bin": {
    "tiacc-mapper": "dist/cli/mapper.js",
    "tiacc-recommend": "dist/cli/recommend.js",
    "tiacc-split": "dist/cli/split.js"
  }
}
```

### Q: 发布失败怎么办？

常见错误：
- **403 Forbidden**: 没有权限，检查 npm 登录状态
- **404 scope not found**: `@tiacc` 组织不存在
- **Name already exists**: 包名被占用，需要改名

### Q: 如何撤回已发布的版本？

```bash
# 撤回指定版本 (72小时内)
npm unpublish @tiacc/tools@1.0.0

# 撤回整个包 (72小时内)
npm unpublish @tiacc/tools --force
```

⚠️ **警告**: 撤回已发布的包会影响依赖它的项目，谨慎操作！

### Q: 如何发布 beta 版本？

```bash
# 更新版本为 beta
npm version 1.1.0-beta.0

# 发布到 beta tag
npm publish --tag beta

# 用户安装
npm install @tiacc/tools@beta
```

## 🎯 替代方案：在未发布到 npm 前如何使用

### 方案 1: npm link (推荐用于开发)

```bash
cd /home/user/TiaCC/tools-node
npm link

# 现在可以全局使用 tia-* 命令
tia-mapper --help
```

### 方案 2: 从 GitHub 安装

```bash
# 全局安装
npm install -g git+https://github.com/lusipad/TiaCC.git#main:tools-node

# 或在项目中
npm install --save-dev git+https://github.com/lusipad/TiaCC.git#main:tools-node
```

### 方案 3: 本地路径安装

```bash
# 在其他项目中
npm install /home/user/TiaCC/tools-node
```

## 📊 发布后的监控

```bash
# 查看下载统计
npm view @tiacc/tools

# 查看依赖项
npm view @tiacc/tools dependencies

# 查看版本历史
npm view @tiacc/tools versions
```

---

**准备好了就发布吧！** 🚀

如有问题，参考 npm 官方文档: https://docs.npmjs.com/cli/v9/commands/npm-publish
