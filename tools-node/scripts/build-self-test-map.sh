#!/bin/bash
# TiaCC Self-Testing Demo Script
# 使用 TiaCC 自己的工具来分析自己的测试覆盖率
# 真正为每个测试文件生成独立的覆盖率报告

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COVERAGE_DIR="$PROJECT_DIR/coverage"
OUTPUT_DIR="$PROJECT_DIR/tiacc-data"
DB_FILE="$OUTPUT_DIR/tiacc-self-test.db"

echo "🎯 TiaCC Self-Testing (Dogfooding)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "这个脚本为每个测试文件生成真正独立的覆盖率报告"
echo "然后使用 TiaCC 构建精确的测试影响映射"
echo ""

# Step 1: 清理并创建输出目录
echo "📁 Step 1: 准备目录..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/coverage"
cd "$PROJECT_DIR"

# Step 2: 获取所有测试文件列表
echo ""
echo "🔍 Step 2: 发现测试文件..."
TEST_FILES=$(find tests -name "*.test.ts" -type f | sort)
TEST_COUNT=$(echo "$TEST_FILES" | wc -l)
echo "   找到 $TEST_COUNT 个测试文件"

# Step 3: 为每个测试文件单独运行测试并生成独立覆盖率
echo ""
echo "🧪 Step 3: 为每个测试生成独立覆盖率报告..."
echo "   ✨ 这是真正的覆盖率，不是简单复制!"
echo ""

PROCESSED=0
for TEST_FILE in $TEST_FILES; do
    PROCESSED=$((PROCESSED + 1))
    # 从路径提取测试名称 (tests/foo.test.ts -> foo)
    TEST_NAME=$(basename "$TEST_FILE" .test.ts)

    echo "   [$PROCESSED/$TEST_COUNT] 运行 $TEST_NAME..."

    # 清理之前的覆盖率
    rm -rf "$COVERAGE_DIR"

    # 单独运行此测试并生成覆盖率
    npm test -- --coverage --run "$TEST_FILE" --silent 2>/dev/null || {
        echo "      ⚠️  测试 $TEST_NAME 运行失败，跳过"
        continue
    }

    # 检查覆盖率文件是否生成
    if [ -f "$COVERAGE_DIR/cobertura-coverage.xml" ]; then
        # 复制到输出目录，使用 TiaCC 期望的命名格式
        cp "$COVERAGE_DIR/cobertura-coverage.xml" "$OUTPUT_DIR/coverage/test_${TEST_NAME}.cobertura.xml"
        echo "      ✅ 覆盖率已保存"
    else
        echo "      ⚠️  未生成覆盖率文件"
    fi
done

# Step 4: 检查生成的覆盖率文件
echo ""
echo "📊 Step 4: 检查生成的覆盖率文件..."
COVERAGE_COUNT=$(ls -1 "$OUTPUT_DIR/coverage/"*.xml 2>/dev/null | wc -l)
echo "   ✅ 成功生成 $COVERAGE_COUNT 个独立覆盖率文件:"
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
