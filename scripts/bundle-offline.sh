#!/usr/bin/env bash
# 打包离线依赖包——在有网络的机器上运行，生成 offline-bundle.tar.gz
#
# 用法:
#   ./scripts/bundle-offline.sh [--node <path>] [--npm-registry <url>]
#
# 生成:
#   offline-bundle.tar.gz  (包含 Python wheels + node_modules)
#
# 在目标机器上使用:
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
BUNDLE_OUT="${PROJECT_ROOT}/offline-bundle.tar.gz"

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

"$PIP" download \
    --dest "${BUNDLE_DIR}/wheels" \
    --python-version "$(python3 -c 'import sys; print(f"{sys.version_info.major}{sys.version_info.minor}")')" \
    --only-binary=:all: \
    nanobind \
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
    nanobind \
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
tar -czf "${BUNDLE_OUT}" -C "${PROJECT_ROOT}" offline-bundle
rm -rf "${BUNDLE_DIR}"

ok "完成！"
echo ""
echo "bundle 大小: $(du -sh "${BUNDLE_OUT}" | cut -f1)"
echo ""
echo "传输到目标机器后："
echo "  ./setup.sh --skip-llvm --offline ${BUNDLE_OUT##*/}"
echo ""
echo "若目标机器无 Node.js >= 14.18："
echo "  ./setup.sh --skip-llvm --offline ${BUNDLE_OUT##*/} --node /path/to/node"
