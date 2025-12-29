# 🐕 TiaCC Dogfooding: 用 TiaCC 测试 TiaCC

## 什么是 Dogfooding?

"Dogfooding" (吃自己的狗粮) 是软件开发中的一个最佳实践，指的是使用自己开发的工具来改进自己的开发流程。

TiaCC 作为一个测试影响分析系统，完全可以用来优化 TiaCC 自己的测试流程！

## 🎯 为什么 TiaCC 需要 Dogfooding?

### 问题
- tools-node 包有多个测试文件 (coverage-parser.test.ts, database.test.ts 等)
- 每次修改代码时，CI 都运行所有测试
- 即使只改了一个文件，也要等待所有测试完成

### 解决方案
使用 TiaCC 自己的工具：
1. **构建映射**: 分析哪些测试覆盖了哪些源文件
2. **智能推荐**: 代码变更时，只运行受影响的测试
3. **加速 CI**: 减少测试时间和资源消耗

## 🚀 快速开始

### 方法 1: 运行演示脚本

最简单的方式是运行我们提供的演示脚本：

```bash
cd tools-node
bash scripts/build-self-test-map.sh
```

这个脚本会：
1. ✅ 运行所有测试并生成 Cobertura 覆盖率
2. 🗺️ 使用 TiaCC mapper 构建测试影响映射数据库
3. 📊 显示数据库统计信息
4. 🔍 演示查询功能

### 方法 2: 手动步骤

如果你想了解每个步骤的细节：

#### Step 1: 生成覆盖率报告

```bash
cd tools-node
npm test -- --coverage --run
```

这会在 `coverage/` 目录生成 `cobertura-coverage.xml`。

#### Step 2: 准备每个测试的独立覆盖率

```bash
mkdir -p tiacc-data/coverage

# 为每个测试文件创建独立的覆盖率文件
# 注意：这是演示，实际应该配置测试框架生成独立覆盖率
cp coverage/cobertura-coverage.xml tiacc-data/coverage/test_coverage-parser.cobertura.xml
cp coverage/cobertura-coverage.xml tiacc-data/coverage/test_database.cobertura.xml
```

> **💡 提示**: 在真实项目中，你应该配置测试框架为每个测试生成独立的覆盖率文件。对于 Vitest，可以使用自定义 reporter 或运行多次测试。

#### Step 3: 构建映射数据库

```bash
npx tsx src/cli/mapper.ts build \
  --coverage-dir tiacc-data/coverage \
  --db tiacc-data/impact_map.db \
  --test-id-from-filename
```

#### Step 4: 查看统计信息

```bash
# 显示数据库统计
npx tsx src/cli/mapper.ts stats --db tiacc-data/impact_map.db

# 查询特定文件被哪些测试覆盖
npx tsx src/cli/mapper.ts query src/coverage-parser.ts \
  --db tiacc-data/impact_map.db
```

#### Step 5: 模拟代码变更，获取受影响的测试

```bash
# 假设你修改了 coverage-parser.ts
npx tsx src/cli/recommend.ts \
  --db tiacc-data/impact_map.db \
  --changed-files src/coverage-parser.ts
```

输出示例：
```
🎯 Recommended tests based on changes:
  ✓ test_coverage-parser

💡 You can save 1 out of 2 tests (50% reduction)
```

## 🔄 CI/CD 集成

我们在 `.github/workflows/tiacc-self-test.yml` 中实现了完整的 CI 集成：

### Nightly Build (主分支)
- 运行所有测试
- 生成完整的覆盖率报告
- 构建测试影响映射数据库
- 保存数据库作为 artifact

### Pull Request
- 下载最新的映射数据库
- 检测 PR 中变更的文件
- 使用 TiaCC recommend 获取受影响的测试
- **只运行受影响的测试！**
- 在 PR 评论中显示结果

### 效果

假设你在 PR 中只修改了 `src/coverage-parser.ts`:

```yaml
# 传统方式
运行测试: coverage-parser.test.ts ✓
运行测试: database.test.ts ✓
运行测试: git-utils.test.ts ✓
...
总耗时: 30 秒

# 使用 TiaCC
🎯 检测到变更: src/coverage-parser.ts
🗺️ 推荐测试: coverage-parser.test.ts
运行测试: coverage-parser.test.ts ✓
总耗时: 10 秒 ⚡️
```

## 📊 可视化分析

### 导出数据到 Dashboard

```bash
npx tsx src/cli/mapper.ts export \
  --db tiacc-data/impact_map.db \
  --output ../dashboard/data/tiacc-self-test.json
```

### 启动 Dashboard

```bash
cd ../dashboard
python -m http.server 8080
```

访问 http://localhost:8080 查看：
- 📈 源文件与测试的依赖关系图
- 📁 按文件夹聚合的覆盖率
- 🔬 函数级别的覆盖详情

## 🎓 学到了什么？

通过这个 dogfooding 案例，你可以：

1. **理解 TiaCC 的价值**
   - 亲眼看到测试时间减少
   - 体验智能测试选择的效果

2. **学习如何在自己项目中使用 TiaCC**
   - 这个例子展示了完整的集成流程
   - 可以直接复制到你的项目

3. **验证 TiaCC 的质量**
   - TiaCC 用自己测试自己
   - 如果它能优化自己的 CI，就能优化你的 CI

## 📝 配置要点

### Vitest 配置

在 `vitest.config.ts` 中启用 Cobertura reporter:

```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'cobertura'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts'],
    },
  },
});
```

### Package.json 脚本

```json
{
  "scripts": {
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "tiacc:build": "bash scripts/build-self-test-map.sh",
    "tiacc:recommend": "tsx src/cli/recommend.ts --db tiacc-data/impact_map.db"
  }
}
```

## ✅ 真正的独立覆盖率

### 工作原理

TiaCC 的 dogfooding 现在为每个测试文件生成**真正独立**的覆盖率报告：

```bash
# 遍历所有测试文件
for TEST_FILE in tests/*.test.ts; do
    # 单独运行每个测试并收集覆盖率
    npm test -- --coverage --run "$TEST_FILE"

    # 保存此测试的独立覆盖率
    cp coverage/cobertura-coverage.xml "tiacc-data/coverage/test_${TEST_NAME}.cobertura.xml"
done
```

这意味着：
- ✅ 每个测试的覆盖率数据是**真实的**，不是简单复制
- ✅ 可以精确知道哪个测试覆盖了哪些源文件
- ✅ PR 时的测试推荐结果是**准确的**

### 覆盖的测试文件

所有 5 个测试文件都会生成独立覆盖率：
- `tests/coverage-parser.test.ts` → `test_coverage-parser.cobertura.xml`
- `tests/database.test.ts` → `test_database.cobertura.xml`
- `tests/git-utils.test.ts` → `test_git-utils.cobertura.xml`
- `tests/index.test.ts` → `test_index.cobertura.xml`
- `tests/symbol-extractor.test.ts` → `test_symbol-extractor.cobertura.xml`

## 🚀 未来改进

- [ ] 添加性能基准测试，量化 TiaCC 带来的 CI 加速
- [ ] 支持更多 JavaScript/TypeScript 测试框架 (Jest, Mocha 等)
- [ ] 探索使用 Vitest 的 `--shard` 功能进一步优化 CI 并行度

## 🤝 贡献

如果你有改进 TiaCC dogfooding 的想法，欢迎提交 PR！

特别欢迎:
- Vitest 独立覆盖率生成方案
- 其他测试框架的集成示例
- CI/CD 优化建议

## 📚 相关资源

- [TiaCC 架构文档](../../docs/architecture.md)
- [集成指南](../../docs/integration-guide.md)
- [CI 模板示例](../../ci-templates/)

---

**💡 记住**: Dogfooding 不仅是使用自己的工具，更是验证工具价值和改进用户体验的最佳方式！
