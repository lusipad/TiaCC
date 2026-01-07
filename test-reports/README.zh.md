# 测试报告（Test Reports）

[English](README.md) | [简体中文](README.zh.md)

本目录用于存放 TiaCC 在分析/自测过程中生成的示例报告与统计输出，也可以在 CI 中作为构建产物归档。

## 用途

1. **示例输出**：展示 TiaCC 能生成什么样的统计/推荐结果
2. **CI 产物**：在 CI/CD 中保存推荐测试列表、数据库统计等，便于排查问题

## 在 CI/CD 中使用（示例：GitHub Actions）

```yaml
- name: 生成 TiaCC 报告
  run: |
    tia-mapper stats --db impact_map.db > ./test-reports/db-stats.txt
    tia-mapper recommend --db impact_map.db --base origin/main --head HEAD > ./test-reports/affected-tests.txt

- name: 上传报告
  uses: actions/upload-artifact@v4
  with:
    name: tiacc-reports
    path: test-reports/
```

## 本地生成

```bash
tia-mapper stats --db impact_map.db > ./test-reports/db-stats.txt
tia-mapper recommend --db impact_map.db --base origin/main --head HEAD > ./test-reports/affected-tests.txt
```

## 相关文档

- [架构](../docs/architecture.md)
- [CI/CD 集成](../docs/ci-cd-integration.md)
- [Dashboard](../docs/dashboard.md)
