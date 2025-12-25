# TiaCC 示例 - 计算器项目

这是一个完整可运行的 TiaCC 演示项目。

## 快速开始

```bash
cd example
npm install
node demo.js
```

## 演示内容

### 交互式演示

```bash
node demo.js
```

这会运行一个完整的演示：
1. 运行所有测试并收集覆盖率
2. 构建源文件→测试的映射数据库
3. 展示不同修改场景下需要运行的测试

### 查询受影响的测试

```bash
# 构建映射数据库
node demo.js --full

# 查询修改 calculator.js 需要运行哪些测试
node demo.js --affected calculator.js

# 同时修改多个文件
node demo.js --affected calculator.js statistics.js
```

## 项目结构

```
example/
├── src/
│   ├── calculator.js    # 基础计算器
│   ├── statistics.js    # 统计函数
│   └── formatter.js     # 数字格式化
├── tests/
│   ├── calculator.test.js
│   ├── advanced.test.js
│   ├── statistics.test.js
│   └── formatter.test.js
├── demo.js              # 演示脚本
└── impact_map.db        # 映射数据库 (运行后生成)
```

## 映射关系

| 源文件 | 关联测试 |
|--------|----------|
| calculator.js | calculator.test.js, advanced.test.js |
| statistics.js | statistics.test.js |
| formatter.js | formatter.test.js |

## 效果

```
修改文件              │ 全量测试  │ TiaCC 推荐
──────────────────────┼───────────┼────────────
calculator.js         │    4      │      2
statistics.js         │    4      │      1
formatter.js          │    4      │      1
calculator + stats    │    4      │      3
```
