# TiaCC Dashboard

> 交互式 Web 界面，用于可视化代码覆盖率和测试影响关系

## 快速开始

### 启动 Dashboard

```bash
cd dashboard
python -m http.server 8080
```

然后在浏览器访问：http://localhost:8080

### 使用示例数据

Dashboard 目录包含示例数据，可以直接启动查看：

```bash
cd TiaCC/dashboard
python -m http.server 8080
```

打开浏览器访问 http://localhost:8080，即可看到示例项目的可视化效果。

## 加载你的项目数据

### 从映射数据库导出

使用 TiaCC CLI 导出你的项目数据：

```bash
cd tools-dotnet
dotnet run --project TiaCC.Cli -- export \
  --db ../impact_map.db \
  --output ../dashboard/data
```

这会在 `dashboard/data/` 目录生成：
- `graph.json` - 节点和边的定义（源文件、测试、符号）
- `symbols.json` - 符号详情（函数名、行号、覆盖率）

### 数据格式

#### graph.json

```json
{
  "nodes": [
    { "id": "src/calculator.cpp", "type": "source", "label": "calculator.cpp" },
    { "id": "test_calc.cpp", "type": "test", "label": "test_calc.cpp" }
  ],
  "links": [
    { "source": "src/calculator.cpp", "target": "test_calc.cpp", "coverage": 85.5 }
  ]
}
```

#### symbols.json

```json
{
  "symbols": [
    {
      "symbolName": "Calculator::add",
      "sourceFile": "src/calculator.cpp",
      "startLine": 15,
      "endLine": 22,
      "tests": [
        { "testScript": "test_calc.cpp", "coverage": 100, "hitCount": 5 }
      ]
    }
  ]
}
```

## 功能特性

### 1. 依赖关系图

- 📊 **力导向图**：D3.js 可视化源文件与测试的关联
- 🔵 **源文件节点**：蓝色圆圈，显示源代码文件
- 🟢 **测试节点**：绿色菱形，显示测试文件
- 🔗 **覆盖率连线**：线条粗细表示覆盖率强度

### 2. 文件列表

- 📁 **文件夹分组**：按目录结构组织，支持折叠/展开
- 📊 **聚合覆盖率**：显示文件夹级别的平均覆盖率
- 🔍 **实时搜索**：输入文件名快速过滤
- 🎯 **推荐测试**：高亮显示受影响的测试

### 3. 详情面板

点击源文件节点查看：

- 📈 **覆盖率统计**：平均覆盖率、函数数量、关联测试数
- 📝 **函数列表**：每个函数的名称、行号、覆盖率、关联测试
- 🔗 **影响分析**：点击"Analyze Impact"查看哪些测试会受影响

### 4. 交互操作

| 操作 | 功能 |
|------|------|
| **拖拽节点** | 调整图布局 |
| **点击节点** | 打开详情面板 |
| **Ctrl+点击** | 多选节点 |
| **搜索** | 实时过滤文件和节点 |
| **Escape** | 关闭详情面板 |

## 自定义配置

Dashboard 是纯静态 HTML/CSS/JavaScript，可以自定义：

- 修改 `index.html` 中的配置项
- 调整颜色主题和布局参数
- 添加自定义统计图表

## 部署

### 静态托管

可以部署到任何静态托管服务：

```bash
# GitHub Pages
cp -r dashboard/* docs/
git add docs && git commit -m "Deploy dashboard"
git push

# Netlify
netlify deploy --dir=dashboard

# Vercel
vercel --prod dashboard
```

### CI/CD 集成

在 CI 中自动更新 Dashboard：

```yaml
- name: Export and deploy dashboard
  run: |
    tia-mapper export --db impact_map.db --output ./dashboard/data
    # 部署到 GitHub Pages 或其他服务
```

## 故障排查

### 数据未显示

1. 检查 `dashboard/data/` 目录是否有 `graph.json` 和 `symbols.json`
2. 打开浏览器开发者工具查看 Console 错误
3. 确认 JSON 文件格式正确（使用 `jq` 验证）

### CORS 错误

使用本地 HTTP 服务器（如 `python -m http.server`），不要直接用 `file://` 协议打开。

### 图显示混乱

- 刷新页面重新布局
- 减少节点数量（使用搜索过滤）
- 调整力导向图参数

## 技术栈

- **D3.js v7** - 数据可视化（本地 lib/d3.v7.min.js）
- **Tailwind CSS** - 样式框架（本地 lib/tailwind.min.css）
- **纯 JavaScript** - 无需构建工具

## 离线使用

Dashboard 支持完全离线使用，所有依赖已本地化：

```
dashboard/
├── lib/
│   ├── d3.v7.min.js        # D3.js v7 本地副本
│   └── tailwind.min.css    # Tailwind CSS 预编译样式
├── data/                    # 数据文件
└── index.html              # 主页面
```

### 本地依赖

Dashboard 已包含所有必需的依赖文件，无需安装额外软件包：
- `lib/d3.v7.min.js` - D3.js 可视化库
- `lib/tailwind.min.css` - Tailwind CSS 预编译样式

## 示例项目

Dashboard 包含的示例数据来自 `tests/e2e/cpp-project`，展示了典型的 C++ 项目结构。

## 更多信息

- 📖 [架构文档](../docs/architecture.md#8-dashboard-可视化)
- 🔧 [集成指南](../docs/integration-guide.md)
- 🎯 [高级功能](../docs/advanced-features.md)
