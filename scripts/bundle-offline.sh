#!/usr/bin/env bash
# 打包离线依赖包——在有网络的机器上运行
#
# 说明：此 bundle 只包含前后端环境依赖，不包含 MLIR Python bindings
# 用户需要在目标机器上单独安装 MLIR
#
# 用法:
#   ./scripts/bundle-offline.sh [--node <path>] [--npm-registry <url>]
#
# 生成:
#   offline-bundle.tar.gz  (包含 Python wheels + node_modules)
#
# 在目标机器上使用:
#   # 1. 确保 MLIR 已安装
#   python3 -c "import mlir.ir as ir; print('MLIR found at:', ir.__file__)"
#   # 或安装 MLIR: conda install -c conda-forge mlir
#
#   # 2. 使用 bundle
#   ./setup.sh --skip-llvm --offline ./offline-bundle.tar.gz

set -eo pipefail

info()  { echo -e "\033[34m[INFO]\033[0m $*"; }
ok()    { echo -e "\033[32m[OK]\033[0m $*"; }
warn()  { echo -e "\033[33m[WARN]\033[0m $*"; }
error() { echo -e "\033[31m[ERROR]\033[0m $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NODE_BIN=""
NPM_REGISTRY=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --node)         NODE_BIN="$2";        shift 2 ;;
        --npm-registry) NPM_REGISTRY="$2";    shift 2 ;;
        -h|--help) sed -n '3,8p' "$0" | sed 's/^# \?//'; exit 0 ;;
        *) error "未知参数: $1" ;;
    esac
done

[[ -n "$NODE_BIN" ]] && export PATH="$(dirname "$NODE_BIN"):$PATH"

BUNDLE_DIR="${PROJECT_ROOT}/offline-bundle"
BUNDLE_OUT="${PROJECT_ROOT}/offline-bundle.tar"

echo "=== 打包离线依赖 ==="
echo ""

# ── Step 1: Python wheels ────────────────────────────────────
info "Step 1: 下载 Python wheels..."
mkdir -p "${BUNDLE_DIR}/wheels"

# 使用 venv Python 保证 wheel 与目标 Python 版本一致
if [[ -f "${PROJECT_ROOT}/backend/.venv/bin/python3" ]]; then
    PIP="${PROJECT_ROOT}/backend/.venv/bin/pip"
    info "使用 venv pip: ${PIP}"
else
    PIP="pip3"
    warn "venv 未找到，使用系统 pip（建议先运行 ./setup.sh --skip-llvm --skip-frontend）"
fi

# 精简版：不包含 MLIR 相关依赖（nanobind, pybind11, numpy）
# 假设用户已经有 MLIR 安装
info "下载后端 Python 依赖（不含 MLIR）..."
"$PIP" download \
    --dest "${BUNDLE_DIR}/wheels" \
    --python-version "$(python3 -c 'import sys; print(f"{sys.version_info.major}{sys.version_info.minor}")')" \
    --only-binary=:all: \
    "fastapi>=0.100" \
    "uvicorn[standard]" \
    python-multipart \
    "pydantic>=2" \
    pyyaml \
    pytest \
    httpx \
    anyio \
    2>/dev/null || \
"$PIP" download \
    --dest "${BUNDLE_DIR}/wheels" \
    "fastapi>=0.100" \
    "uvicorn[standard]" \
    python-multipart \
    "pydantic>=2" \
    pyyaml \
    pytest \
    httpx \
    anyio

ok "Python wheels 已下载到 ${BUNDLE_DIR}/wheels/"

# ── Step 2: node_modules ─────────────────────────────────────
info "Step 2: 准备 node_modules..."
FRONTEND_DIR="${PROJECT_ROOT}/frontend"

if [[ ! -d "${FRONTEND_DIR}/node_modules" ]]; then
    info "首次安装 node_modules（需要网络）..."
    npm_args=(--prefix "$FRONTEND_DIR" install --legacy-peer-deps)
    [[ -n "$NPM_REGISTRY" ]] && npm_args+=(--registry "$NPM_REGISTRY")
    npm "${npm_args[@]}"
fi

info "打包 node_modules..."
tar -czf "${BUNDLE_DIR}/node_modules.tar.gz" \
    -C "${FRONTEND_DIR}" node_modules
ok "node_modules 已打包: $(du -sh "${BUNDLE_DIR}/node_modules.tar.gz" | cut -f1)"

# ── Step 3: 写入平台信息 ──────────────────────────────────────
python3 -c "
import json, sys, platform
info = {
    'python_version': sys.version,
    'platform': platform.platform(),
    'arch': platform.machine(),
}
with open('${BUNDLE_DIR}/bundle-info.json', 'w') as f:
    json.dump(info, f, indent=2)
print(json.dumps(info, indent=2))
"

# ── Step 4: 打包 ─────────────────────────────────────────────
info "Step 3: 生成 offline-bundle.tar.gz..."
# 使用 --posix 选项以确保兼容性，并使用相对路径
tar -czf "${BUNDLE_OUT}" --posix -C "${PROJECT_ROOT}" offline-bundle/

# 验证生成的 bundle
info "验证 bundle 文件..."
if [ ! -f "${BUNDLE_OUT}" ]; then
    error "Bundle 文件未生成: ${BUNDLE_OUT}"
fi

# 检查文件大小
BUNDLE_SIZE=$(stat -f%z "${BUNDLE_OUT}" 2>/dev/null || stat -c%s "${BUNDLE_OUT}" 2>/dev/null)
if [ -z "$BUNDLE_SIZE" ] || [ "$BUNDLE_SIZE" -eq 0 ]; then
    error "Bundle 文件大小为 0: ${BUNDLE_SIZE}"
fi
info "Bundle 文件大小: ${BUNDLE_SIZE} bytes"

# 验证 tar.gz 格式
if ! tar -tzf "${BUNDLE_OUT}" > /dev/null 2>&1; then
    error "生成的 bundle 不是有效的 tar.gz 文件"
fi
ok "Bundle 格式验证通过"

# 生成校验和
info "生成校验和..."
SHA256=$(shasum -a 256 "${BUNDLE_OUT}" 2>/dev/null | awk '{print $1}' || sha256sum "${BUNDLE_OUT}" 2>/dev/null | awk '{print $1}')
MD5=$(md5 -q "${BUNDLE_OUT}" 2>/dev/null || md5sum "${BUNDLE_OUT}" 2>/dev/null | awk '{print $1}')

CHECKSUM_FILE="${BUNDLE_OUT}.checksums"
cat > "${CHECKSUM_FILE}" << EOF
Filename: ${BUNDLE_OUT##*/}
SHA256: ${SHA256}
MD5: ${MD5}
Size: ${BUNDLE_SIZE} bytes
Platform: $(python3 -c "import platform; print(platform.platform())")
Arch: $(python3 -c "import platform; print(platform.machine())")
Python: $(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
EOF

rm -rf "${BUNDLE_DIR}"

ok "完成！"
echo ""
echo "Bundle 信息:"
echo "  文件名: ${BUNDLE_OUT##*/}"
echo "  大小: $(du -sh "${BUNDLE_OUT}" | cut -f1)"
echo "  SHA256: ${SHA256}"
echo "  MD5: ${MD5}"
echo ""
echo "校验和文件: ${CHECKSUM_FILE##*/}"
echo ""
echo "=== 在目标机器上的使用方法 ==="
echo ""
echo "1. 传输文件到目标机器"
echo ""
echo "2. 验证文件完整性（推荐）:"
echo "   # Linux:"
echo "   echo '${SHA256}  ${BUNDLE_OUT##*/}' | sha256sum -c -"
echo "   # macOS:"
echo "   shasum -a 256 ${BUNDLE_OUT##*/} | awk '{print \$1}' | grep -q '${SHA256}' && echo '✓ Checksum OK'"
echo ""
echo "3. 运行安装:"
echo "   ./setup.sh --skip-llvm --offline ${BUNDLE_OUT##*/}"
echo ""
echo "4. 若目标机器无 Node.js >= 14.18："
echo "   ./setup.sh --skip-llvm --offline ${BUNDLE_OUT##*/} --node /path/to/node"
echo ""
echo "若遇到解压错误，请检查:"
echo "  1. 文件是否下载完整（检查文件大小和校验和）"
echo "  2. 传输过程中是否损坏（重新下载）"
echo "  3. 使用 tar --version 检查 tar 版本兼容性"
