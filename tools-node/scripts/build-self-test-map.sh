#!/bin/bash
# TiaCC Self-Testing Demo Script
# 演示如何使用 TiaCC 自己的工具来分析自己的测试覆盖率

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COVERAGE_DIR="$PROJECT_DIR/coverage"
OUTPUT_DIR="$PROJECT_DIR/tiacc-data"
DB_FILE="$OUTPUT_DIR/tiacc-self-test.db"

echo "🎯 TiaCC Self-Testing Demo"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "这个脚本演示了如何用 TiaCC 来测试 TiaCC 自己！"
echo "也就是所谓的 'dogfooding' (吃自己的狗粮)"
echo ""

# Step 1: 清理并创建输出目录
echo "📁 Step 1: 准备目录..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/coverage"

# Step 2: 运行测试并生成覆盖率
echo ""
echo "🧪 Step 2: 运行测试并生成 Cobertura 覆盖率报告..."
cd "$PROJECT_DIR"
npm test -- --coverage --run --silent 2>&1 | tail -15

# Step 3: 检查覆盖率文件
echo ""
echo "📊 Step 3: 检查生成的覆盖率文件..."
if [ ! -f "$COVERAGE_DIR/cobertura-coverage.xml" ]; then
    echo "❌ 错误: 未找到 Cobertura 覆盖率文件!"
    echo "   请确保 vitest.config.ts 配置了 cobertura reporter"
    exit 1
fi

echo "✅ 找到覆盖率文件: cobertura-coverage.xml"
FILESIZE=$(ls -lh "$COVERAGE_DIR/cobertura-coverage.xml" | awk '{print $5}')
echo "   文件大小: $FILESIZE"

# Step 4: 模拟每个测试的独立覆盖率
echo ""
echo "🔀 Step 4: 为每个测试创建独立的覆盖率文件..."
echo ""
echo "   ⚠️  注意: Vitest 默认生成聚合覆盖率"
echo "   在实际应用中，应该配置测试框架为每个测试生成独立的覆盖率文件"
echo "   这里我们通过复制和重命名来模拟每个测试的覆盖率"
echo ""

# 为测试文件创建独立的覆盖率文件（使用 TiaCC 期望的命名格式）
cp "$COVERAGE_DIR/cobertura-coverage.xml" "$OUTPUT_DIR/coverage/test_coverage-parser.cobertura.xml"
cp "$COVERAGE_DIR/cobertura-coverage.xml" "$OUTPUT_DIR/coverage/test_database.cobertura.xml"

echo "✅ 创建了 2 个独立的覆盖率文件"
ls -1 "$OUTPUT_DIR/coverage/"

# Step 5: 使用 TiaCC 的 mapper 工具构建映射数据库
echo ""
echo "🗺️  Step 5: 使用 TiaCC 自己的 mapper 工具构建测试影响映射数据库..."
echo ""

npx tsx src/cli/mapper.ts build \
  --coverage-dir "$OUTPUT_DIR/coverage" \
  --db "$DB_FILE" \
  --test-id-from-filename

# Step 6: 验证并查询数据库
echo ""
echo "✅ Step 6: 验证数据库并显示统计..."
if [ -f "$DB_FILE" ]; then
    echo ""
    echo "✅ 数据库创建成功!"
    DBSIZE=$(ls -lh "$DB_FILE" | awk '{print $5}')
    echo "   数据库位置: $DB_FILE"
    echo "   数据库大小: $DBSIZE"

    echo ""
    echo "📊 数据库统计信息:"
    npx tsx src/cli/mapper.ts stats --db "$DB_FILE"

    echo ""
    echo "🔍 示例查询: 哪些测试覆盖了 coverage-parser.ts?"
    npx tsx src/cli/mapper.ts query src/coverage-parser.ts --db "$DB_FILE" || echo "   (文件可能未被追踪)"
else
    echo "❌ 错误: 数据库文件未创建!"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 TiaCC Self-Testing Demo 完成!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 接下来可以尝试:"
echo ""
echo "  1️⃣  查看 Dashboard (可视化):"
echo "     cd ../dashboard && python -m http.server 8080"
echo ""
echo "  2️⃣  模拟代码变更，获取受影响的测试:"
echo "     # 假设你修改了 src/coverage-parser.ts"
echo "     npx tsx src/cli/recommend.ts \\"
echo "       --db $DB_FILE \\"
echo "       --changed-files src/coverage-parser.ts"
echo ""
echo "  3️⃣  导出数据到 JSON 供 Dashboard 使用:"
echo "     npx tsx src/cli/mapper.ts export \\"
echo "       --db $DB_FILE \\"
echo "       --output ../dashboard/data/tiacc-self-test.json"
echo ""
echo "💡 这展示了 TiaCC 如何用自己的工具来优化自己的 CI/CD!"
echo ""
