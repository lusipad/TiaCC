#!/bin/bash
# TiaCC CLI 构建和发布脚本
# 生成各平台的单文件可执行程序

set -e

VERSION="1.0.0"
OUTPUT_DIR="./publish"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  TiaCC CLI 构建系统                                        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# 清理旧构建
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# 定义目标平台
TARGETS=(
    "win-x64"
    "win-arm64"
    "linux-x64"
    "linux-arm64"
    "osx-x64"
    "osx-arm64"
)

# 构建各平台版本
for RID in "${TARGETS[@]}"; do
    echo -e "${GREEN}构建 $RID ...${NC}"

    dotnet publish "$PROJECT_DIR/TiaCC.Cli.csproj" \
        -c Release \
        -r "$RID" \
        -o "$OUTPUT_DIR/$RID" \
        --self-contained true \
        -p:PublishSingleFile=true \
        -p:PublishTrimmed=true \
        -p:EnableCompressionInSingleFile=true

    # 重命名可执行文件
    if [[ "$RID" == win-* ]]; then
        mv "$OUTPUT_DIR/$RID/tiacc.exe" "$OUTPUT_DIR/tiacc-$RID.exe"
    else
        mv "$OUTPUT_DIR/$RID/tiacc" "$OUTPUT_DIR/tiacc-$RID"
        chmod +x "$OUTPUT_DIR/tiacc-$RID"
    fi

    # 清理临时目录
    rm -rf "$OUTPUT_DIR/$RID"

    echo "  完成: $OUTPUT_DIR/tiacc-$RID"
done

echo ""
echo -e "${GREEN}═════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}构建完成!${NC}"
echo ""
echo "输出文件:"
ls -lh "$OUTPUT_DIR"/tiacc-*
echo ""
echo "使用方法:"
echo "  ./tiacc-linux-x64 collect --command \"dotnet test\""
echo "  ./tiacc-linux-x64 --help"
