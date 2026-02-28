#!/usr/bin/env bash
# Bundle 诊断工具 - 帮助诊断离线包相关问题

set -eo pipefail

info()  { echo -e "\033[34m[INFO]\033[0m $*"; }
ok()    { echo -e "\033[32m[OK]\033[0m $*"; }
warn()  { echo -e "\033[33m[WARN]\033[0m $*"; }
error() { echo -e "\033[31m[ERROR]\033[0m $*"; }

BUNDLE_FILE="${1:-}"

if [[ -z "$BUNDLE_FILE" ]]; then
    error "用法: $0 <bundle-file.tar.gz>"
fi

if [[ ! -f "$BUNDLE_FILE" ]]; then
    error "文件不存在: $BUNDLE_FILE"
fi

echo "=== Bundle 诊断工具 ==="
echo ""

info "文件基本信息:"
echo "  路径: $BUNDLE_FILE"
echo "  大小: $(stat -f%z "$BUNDLE_FILE" 2>/dev/null || stat -c%s "$BUNDLE_FILE" 2>/dev/null) bytes"
echo "  类型: $(file "$BUNDLE_FILE" 2>/dev/null || echo 'Unknown')"
echo ""

info "校验和计算:"
SHA256=$(shasum -a 256 "$BUNDLE_FILE" 2>/dev/null | awk '{print $1}' || sha256sum "$BUNDLE_FILE" 2>/dev/null | awk '{print $1}')
MD5=$(md5 -q "$BUNDLE_FILE" 2>/dev/null || md5sum "$BUNDLE_FILE" 2>/dev/null | awk '{print $1}')
echo "  SHA256: ${SHA256:-无法计算}"
echo "  MD5: ${MD5:-无法计算}"
echo ""

info "文件头分析:"
echo "  前 64 字节（十六进制）:"
head -c 64 "$BUNDLE_FILE" | od -A x -t x1z -v
echo ""

info "tar.gz 格式验证:"
if tar -tzf "$BUNDLE_FILE" > /dev/null 2>&1; then
    ok "✓ 有效的 tar.gz 文件"

    info "内容列表:"
    tar -tzf "$BUNDLE_FILE" | head -20
    if tar -tzf "$BUNDLE_FILE" | wc -l | grep -q '^2[0-9]' 2>/dev/null; then
        TOTAL=$(tar -tzf "$BUNDLE_FILE" | wc -l | tr -d ' ')
        info "  ... 共 $TOTAL 个文件"
    fi
else
    error "✗ 无效的 tar.gz 文件"

    info "尝试识别文件格式:"
    MAGIC=$(head -c 4 "$BUNDLE_FILE" | od -A n -t x1 | tr -d ' ')
    case "$MAGIC" in
        1f8b) info "  看起来是 gzip 文件，但 tar 解压失败" ;;
        504b) info "  看起来是 ZIP 文件（tar.gz 的常见错误）" ;;
        edfe) info "  看起来可能需要修复文件尾" ;;
        *) info "  未知的文件格式" ;;
    esac
fi
echo ""

info "系统信息:"
echo "  系统: $(uname -s) $(uname -r)"
echo "  架构: $(uname -m)"
echo "  tar 版本: $(tar --version | head -1)"
echo "  gzip 版本: $(gzip --version | head -1)"

# 建议修复方案
echo ""
echo "=== 修复建议 ==="
if ! tar -tzf "$BUNDLE_FILE" > /dev/null 2>&1; then
    warn "Bundle 文件损坏或格式错误"
    echo ""
    echo "解决方案:"
    echo "1. 重新下载文件"
    echo "2. 检查下载连接是否稳定"
    echo "3. 验证校验和是否匹配"
    echo "4. 尝试使用其他传输方式（如 rsync 替代 wget/cp）"
    echo ""
    echo "如果需要重新生成 bundle，请运行:"
    echo "  ./scripts/bundle-offline.sh"
else
    ok "Bundle 文件正常"
    echo "可以安全使用:"
    echo "  ./setup.sh --skip-llvm --offline $BUNDLE_FILE"
fi
