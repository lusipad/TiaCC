# TiaCC 问题发现报告

[English](BUG_DISCOVERY_REPORT.md) | [简体中文](BUG_DISCOVERY_REPORT.zh.md)

## 摘要

通过系统性的边界条件测试，我们在 TiaCC 项目中发现了多个潜在问题。这些测试专注于发现真正的 bug，而不是仅仅追求覆盖率数字。

## 🐛 发现的 Bug

### 1. **DatabaseService: NaN 值导致数据库异常** (严重)
- **位置**: `DatabaseService.UpsertCoverageMapAsync`
- **问题**: 当传入 `double.NaN` 作为覆盖率值时，SQLite 抛出 `DbUpdateException`
- **错误消息**: `Cannot store 'NaN' values`
- **建议修复**: 在服务层添加输入验证

```csharp
// 建议的修复
if (double.IsNaN(coverage) || double.IsInfinity(coverage))
{
    throw new ArgumentException("Coverage must be a valid number", nameof(coverage));
}
```

### 2. **CoverageParser: null Lines 值导致异常** (中等)
- **位置**: `CoverageParser.ParseCoverletJson`
- **问题**: Coverlet JSON 中的 `Lines: null` 导致 `InvalidOperationException`
- **原因**: 代码尝试在 null 值上调用 `EnumerateObject()`
- **建议修复**: 在枚举前检查 null

### 3. **CoverageParser: 未知 JSON 格式处理不佳** (低)
- **位置**: `CoverageParser.Parse`
- **问题**: 对于无法识别的 JSON 格式，抛出 `InvalidOperationException` 而非返回空结果
- **建议修复**: 添加 try-catch 并返回空 `CoverageData`

## ⚠️ 潜在问题 (已记录行为)

### 4. **DatabaseService: 允许无效覆盖率值**
- 接受负数覆盖率 (-1.0%)
- 接受超过 100% 的覆盖率 (100.001%)
- 接受 `double.MaxValue`
- **建议**: 添加验证限制覆盖率在 0-100 范围内

### 5. **DatabaseService: 允许空文件路径**
- 空字符串 `""` 和空白字符串 `"   "` 都可用作文件路径
- **建议**: 添加非空验证

### 6. **DatabaseService: 允许无效行号**
- 负数行号 (如 -5 到 -1)
- 起始行大于结束行 (如 100 到 50)
- **建议**: 添加行号验证

### 7. **DatabaseService: 路径规范化不一致**
- `src/test.cs` 和 `src\test.cs` 被视为不同文件
- `./src/test.cs` 也被视为不同文件
- **建议**: 在存储前规范化路径

## ✅ 正确处理的边界情况

- **Cobertura XML 缺少 line-rate**: 使用行计数数据优雅处理
- **空数据库查询**: 正确返回空结果
- **并发 GetOrCreate**: 正确处理竞态条件 (经修复后)
- **特殊字符路径**: SQL 注入防护有效
- **非常长的路径**: 正确存储和检索
- **多次 Dispose 调用**: 不抛出异常

## 📊 覆盖率改进

| 指标 | 修改前 | 修改后 | 变化 |
|------|-------|-------|------|
| 行覆盖率 | 72% | 74% | +2% |
| 分支覆盖率 | 49.6% | 52.7% | +3.1% |
| 方法覆盖率 | 85% | 87.8% | +2.8% |
| DatabaseService | 86.2% | 91.8% | +5.6% |
| CoverageParser | 55% | 58% | +3% |

## 📝 测试文件摘要

新增的边界条件测试文件：
1. `DatabaseServiceEdgeCaseTests.cs` - 22 个测试
2. `CoverageParserEdgeCaseTests.cs` - 35 个测试
3. `SymbolExtractorEdgeCaseTests.cs` - 29 个测试

**总测试数**: 89 → 157 (+68 个测试)

## 🔧 建议的后续工作

1. **优先修复 Bug #1-3** - 这些是发现的真正 bug
2. **添加输入验证** - 解决潜在问题 #4-7
3. **增加 GitService 测试** - 当前覆盖率仅 64.7%
4. **增加 CoverageParser LLVM 格式测试** - 这部分覆盖率较低
