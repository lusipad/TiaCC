# TiaCC CI/CD 集成指南

[English](ci-cd-integration.md) | [简体中文](ci-cd-integration.zh.md)

> 本文档聚焦如何把 TiaCC 集成进常见 CI/CD 平台，让 PR/提交时只运行受影响的测试，从而显著缩短 CI 时间。
>
> 📖 覆盖率采集与映射库构建（Nightly 构建）请参考：[集成指南](integration-guide.zh.md)

## 核心思路

1. **Nightly**：运行全量测试并收集覆盖率，使用 `tia-mapper map` 生成/更新 `impact_map.db`
2. **PR/提交**：基于 git diff 找出变更文件，用 `tia-mapper recommend` 或 `tia-mapper query` 得到受影响测试列表
3. **只跑受影响测试**：将受影响测试列表转换为测试框架的 filter/selector

## GitHub Actions（示例）

```yaml
name: Smart Test
on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          global-json-file: global.json

      - name: Recommend affected tests
        run: |
          tia-mapper recommend --db impact_map.db --base origin/main --head HEAD > affected_tests.txt

      - name: Run affected tests
        run: |
          FILTER=$(cat affected_tests.txt | tr '\n' '|' | sed 's/|$//')
          dotnet test --filter "FullyQualifiedName~$FILTER"
```

## 其他平台

- GitLab CI / Azure Pipelines / Jenkins：思路相同，关键是拿到 diff 文件列表，并把推荐结果转换成平台/测试框架可用的过滤表达式。
- 更完整的配置片段与注意事项见英文版本：`docs/ci-cd-integration.md`。
