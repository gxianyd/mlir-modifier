#!/usr/bin/env bash
# 一键导入自定义 dialect Python binding（方式 A：复制到 MLIR Python 包）
#
# 用法:
#   ./scripts/import-dialect.sh <dialect_name> <file1.py> [file2.py ...]
#
# 例：
#   ./scripts/import-dialect.sh hbir ./build/_hbir_ops_gen.py
#   ./scripts/import-dialect.sh hbir ./build/hbir.py ./build/_hbir_ops_gen.py
#
# 效果：
#   1. 将 binding 文件复制到 $MLIR_PYTHON_ROOT/mlir/dialects/
#   2. 若缺少 <dialect>.py 入口模块，则自动从 _<dialect>_ops_gen.py 生成
#   3. 将 dialect 名写入 dialect_registry.py 的 _BUILTIN_DIALECT_MODULES
#   4. 验证：检查 dialect 可导入、op 列表、op 签名

set -eo pipefail

info()  { echo -e "\033[34m[INFO]\033[0m $*"; }
ok()    { echo -e "\033[32m[OK]\033[0m $*"; }
warn()  { echo -e "\033[33m[WARN]\033[0m $*"; }
error() { echo -e "\033[31m[ERROR]\033[0m $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ $# -lt 2 ]]; then
    sed -n '3,10p' "$0" | sed 's/^# \?//'
    exit 1
fi

DIALECT_NAME="$1"
shift
BINDING_FILES=("$@")

# ── 激活 venv（其中已包含正确的 PYTHONPATH / LD_LIBRARY_PATH）──
VENV="${PROJECT_ROOT}/backend/.venv"
[[ -d "$VENV" ]] || error "venv 不存在: ${VENV}\n请先运行 ./setup.sh"
# shellcheck source=/dev/null
source "${VENV}/bin/activate"

# ── 定位 MLIR Python 包 ─────────────────────────────────────
MLIR_PYTHON_ROOT=$(python3 -c "
import mlir.ir, os
print(os.path.dirname(mlir.ir.__file__))
" 2>/dev/null) || error "找不到 mlir Python 包，检查 venv 中的 PYTHONPATH 是否正确"

DIALECTS_DIR="${MLIR_PYTHON_ROOT}/dialects"
info "MLIR dialects 目录: ${DIALECTS_DIR}"

# ── Step 1: 复制 binding 文件 ────────────────────────────────
info "Step 1: 复制 binding 文件..."
for f in "${BINDING_FILES[@]}"; do
    [[ -f "$f" ]] || error "文件不存在: $f"
    cp "$f" "${DIALECTS_DIR}/$(basename "$f")"
    ok "  $(basename "$f")"
done

# ── Step 2: 生成入口模块（若未提供）────────────────────────────
ENTRY_FILE="${DIALECTS_DIR}/${DIALECT_NAME}.py"
if [[ ! -f "$ENTRY_FILE" ]]; then
    OPS_GEN="${DIALECTS_DIR}/_${DIALECT_NAME}_ops_gen.py"
    if [[ -f "$OPS_GEN" ]]; then
        printf '# Auto-generated entry — do not edit\nfrom ._%s_ops_gen import *  # noqa: F401,F403\n' \
            "${DIALECT_NAME}" > "$ENTRY_FILE"
        ok "  生成入口模块: ${DIALECT_NAME}.py (from _${DIALECT_NAME}_ops_gen.py)"
    else
        warn "未找到 _${DIALECT_NAME}_ops_gen.py，请检查提供的文件中是否包含正确的 ops gen 文件"
    fi
else
    ok "  入口模块已存在: ${DIALECT_NAME}.py"
fi

# ── Step 3: 注册到 dialect_registry.py ─────────────────────
info "Step 2: 注册到 dialect_registry.py..."
REGISTRY="${PROJECT_ROOT}/backend/app/services/dialect_registry.py"
python3 - <<PYEOF
import re, sys

dialect = "${DIALECT_NAME}"
registry = "${REGISTRY}"

with open(registry) as f:
    content = f.read()

if f'"{dialect}"' in content:
    print(f"  '{dialect}' 已在 _BUILTIN_DIALECT_MODULES 中，跳过")
    sys.exit(0)

# 在列表末尾（\n] 之前）插入新条目
pattern = r'(_BUILTIN_DIALECT_MODULES: list\[str\] = \[)(.*?)(\n\])'
match = re.search(pattern, content, re.DOTALL)
if not match:
    print(f"  [WARN] 未找到 _BUILTIN_DIALECT_MODULES，请手动添加: \"{dialect}\"")
    sys.exit(0)

new_content = (
    content[:match.end(2)]
    + f'\n    "{dialect}",'
    + content[match.start(3):]
)
with open(registry, "w") as f:
    f.write(new_content)
print(f"  已添加 '{dialect}' 到 _BUILTIN_DIALECT_MODULES")
PYEOF

# ── Step 4: 验证 ─────────────────────────────────────────────
info "Step 3: 验证..."
cd "${PROJECT_ROOT}/backend"
python3 - <<PYEOF
import sys
sys.path.insert(0, ".")

from app.services.dialect_registry import list_dialects, list_ops, get_op_signature

dialect = "${DIALECT_NAME}"

# 检查 dialect 可见
dialects = list_dialects()
if dialect not in dialects:
    print(f"  [FAIL] '{dialect}' 不在 dialect 列表中")
    print(f"         可能原因：入口模块 {dialect}.py 不可导入，或不在 PYTHONPATH 中")
    sys.exit(1)
print(f"  [OK] dialect '{dialect}' 可见")

# 检查 op 列表
ops = list_ops(dialect)
if not ops:
    print(f"  [WARN] 未发现任何 op（检查 binding 文件中是否定义了 OPERATION_NAME）")
else:
    print(f"  [OK] 发现 {len(ops)} 个 op:")
    for o in ops:
        sig = get_op_signature(o.name)
        if sig:
            params = ", ".join(f"{p.name}({p.kind})" for p in sig.params)
            print(f"       {o.name}  results={sig.num_results}  params=[{params}]")
        else:
            print(f"       {o.name}  (签名未解析)")
PYEOF

echo ""
ok "Dialect '${DIALECT_NAME}' 导入完成！重启后端（./start-backend.sh）后生效。"
