#!/usr/bin/env bash
# MLIR Modifier 一键配置脚本
#
# 用法: ./setup.sh [选项]
#
# 选项:
#   --llvm-dir   <path>   LLVM 源码目录（默认: ../llvm-project）
#   --llvm-tag   <tag>    克隆指定版本，如 llvmorg-19.1.0（默认: main）
#   --jobs       <N>      编译并行数（默认: nproc）
#   --cc         <path>   C 编译器路径
#   --cxx        <path>   C++ 编译器路径
#   --libstdcxx-dir <dir> 指定 libstdc++ 目录（解决 GLIBCXX not found）
#   --ninja      <path>   ninja 可执行路径
#   --node       <path>   node 可执行路径（npm 从同目录推导）
#   --npm-registry <url>  npm 镜像源（网络受限时使用，如淘宝镜像）
#   --skip-llvm           跳过 LLVM 克隆与编译
#   --skip-backend        跳过后端依赖安装
#   --skip-frontend       跳过前端依赖安装
#   --offline    <path>   使用离线依赖包（由 scripts/bundle-offline.sh 生成）
#   -h, --help            显示帮助

set -eo pipefail

# ── 日志 ────────────────────────────────────────────────────
info()  { echo -e "\033[34m[INFO]\033[0m $*"; }
ok()    { echo -e "\033[32m[OK]\033[0m $*"; }
warn()  { echo -e "\033[33m[WARN]\033[0m $*"; }
error() { echo -e "\033[31m[ERROR]\033[0m $*"; exit 1; }

# ── 默认值 ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LLVM_DIR="$(realpath -m "${SCRIPT_DIR}/../llvm-project")"
LLVM_TAG="llvmorg-19.1.7"      # 经过验证的稳定版本；覆盖: --llvm-tag main
JOBS="$(nproc)"
CC_BIN=""
CXX_BIN=""
LIBSTDCXX_DIR=""
NINJA_BIN=""
NODE_BIN=""
NPM_REGISTRY=""
SKIP_LLVM=false
SKIP_BACKEND=false
SKIP_FRONTEND=false
OFFLINE_BUNDLE=""

# ── 参数解析 ─────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --llvm-dir)      LLVM_DIR="$(realpath -m "$2")"; shift 2 ;;
        --llvm-tag)      LLVM_TAG="$2";         shift 2 ;;
        --jobs)          JOBS="$2";             shift 2 ;;
        --cc)            CC_BIN="$2";           shift 2 ;;
        --cxx)           CXX_BIN="$2";          shift 2 ;;
        --libstdcxx-dir) LIBSTDCXX_DIR="$2";    shift 2 ;;
        --ninja)         NINJA_BIN="$2";        shift 2 ;;
        --node)          NODE_BIN="$2";         shift 2 ;;
        --npm-registry)  NPM_REGISTRY="$2";      shift 2 ;;
        --skip-llvm)     SKIP_LLVM=true;        shift ;;
        --skip-backend)  SKIP_BACKEND=true;     shift ;;
        --skip-frontend) SKIP_FRONTEND=true;    shift ;;
        --offline)       OFFLINE_BUNDLE="$(realpath "$2")"; shift 2 ;;
        -h|--help) sed -n '3,18p' "$0" | sed 's/^# \?//'; exit 0 ;;
        *) error "未知参数: $1（使用 --help 查看帮助）" ;;
    esac
done

BACKEND_DIR="${SCRIPT_DIR}/backend"
FRONTEND_DIR="${SCRIPT_DIR}/frontend"
VENV_DIR="${BACKEND_DIR}/.venv"
VENV_PYTHON="${VENV_DIR}/bin/python3"
MLIR_BINDING="${LLVM_DIR}/build/tools/mlir/python_packages/mlir_core"

# ── 离线包解压 ───────────────────────────────────────────────
# 若提供了 --offline，将 bundle 解压到临时目录并设置 OFFLINE_DIR
OFFLINE_DIR=""
if [[ -n "$OFFLINE_BUNDLE" ]]; then
    [[ -e "$OFFLINE_BUNDLE" ]] || error "离线包不存在: ${OFFLINE_BUNDLE}"
    OFFLINE_DIR="${SCRIPT_DIR}/.offline-bundle-extracted"
    rm -rf "$OFFLINE_DIR" && mkdir -p "$OFFLINE_DIR"
    if [[ -f "$OFFLINE_BUNDLE" && "$OFFLINE_BUNDLE" == *.tar.gz ]]; then
        tar -xzf "$OFFLINE_BUNDLE" -C "$OFFLINE_DIR" --strip-components=1
    elif [[ -d "$OFFLINE_BUNDLE" ]]; then
        cp -r "$OFFLINE_BUNDLE/." "$OFFLINE_DIR/"
    else
        error "离线包格式不支持（需要 .tar.gz 或目录）: ${OFFLINE_BUNDLE}"
    fi
    info "离线包已解压: ${OFFLINE_DIR}"
    [[ -f "${OFFLINE_DIR}/bundle-info.json" ]] && \
        info "bundle 信息: $(cat "${OFFLINE_DIR}/bundle-info.json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("platform","?"))')"
fi

echo ""
echo "=== MLIR Modifier 一键配置 ==="
info "项目目录: ${SCRIPT_DIR}"
info "LLVM 目录: ${LLVM_DIR}"
info "编译并行: ${JOBS}"
echo ""

# ── Step 0: 系统依赖 ─────────────────────────────────────────
info "[0/4] 检查系统依赖..."

# 自定义路径必须在依赖检查前生效
[[ -n "$NODE_BIN"  ]] && export PATH="$(dirname "$NODE_BIN"):$PATH"  && info "node:  ${NODE_BIN}"
[[ -n "$NINJA_BIN" ]] && export PATH="$(dirname "$NINJA_BIN"):$PATH" && info "ninja: ${NINJA_BIN}"
[[ -n "$CC_BIN"    ]] && export PATH="$(dirname "$CC_BIN"):$PATH"
[[ -n "$CXX_BIN"   ]] && export PATH="$(dirname "$CXX_BIN"):$PATH"

# Node.js 版本检查（vite 4 ESM 要求 >= 14.18）
_node_ver=$(node -e "process.stdout.write(process.versions.node)" 2>/dev/null || echo "0.0.0")
_node_major="${_node_ver%%.*}"
_node_minor=$(echo "$_node_ver" | cut -d. -f2)
if [[ "$_node_major" -lt 14 ]] || { [[ "$_node_major" -eq 14 ]] && [[ "$_node_minor" -lt 18 ]]; }; then
    error "Node.js ${_node_ver} 太旧，需要 >= 14.18（vite 4 要求）。请用 --node 指定更新版本，如：./setup.sh --node /path/to/node16/bin/node"
fi

# 收集所有缺失工具
missing=()
for cmd in cmake ninja gcc g++ git python3 node npm; do
    command -v "$cmd" &>/dev/null || missing+=("$cmd")
done

if [[ ${#missing[@]} -gt 0 ]]; then
    if command -v apt-get &>/dev/null; then
        warn "缺少工具: ${missing[*]}，尝试 apt-get 安装..."
        sudo apt-get install -y cmake ninja-build gcc g++ git python3 python3-venv nodejs npm
        # 安装后再次验证
        still_missing=()
        for cmd in "${missing[@]}"; do
            command -v "$cmd" &>/dev/null || still_missing+=("$cmd")
        done
        [[ ${#still_missing[@]} -gt 0 ]] && error "安装后仍缺少: ${still_missing[*]}"
    else
        error "缺少工具: ${missing[*]}，请手动安装后重试"
    fi
fi

# libstdc++ 兼容处理（HPC/旧系统 GLIBCXX/CXXABI not found）
# 同时写入 activate，使后端运行时也能找到正确的 libstdc++
_cxx="${CXX_BIN:-${CXX:-g++}}"
RESOLVED_LIBSTDCXX_DIR=""
if [[ -n "$LIBSTDCXX_DIR" ]]; then
    RESOLVED_LIBSTDCXX_DIR="$LIBSTDCXX_DIR"
else
    _so=$("$_cxx" -print-file-name=libstdc++.so.6 2>/dev/null || true)
    if [[ -n "$_so" && "$_so" != "libstdc++.so.6" ]]; then
        RESOLVED_LIBSTDCXX_DIR="$(dirname "$_so")"
    fi
fi
if [[ -n "$RESOLVED_LIBSTDCXX_DIR" ]]; then
    export LD_LIBRARY_PATH="${RESOLVED_LIBSTDCXX_DIR}:${LD_LIBRARY_PATH:-}"
    info "libstdc++ 目录: ${RESOLVED_LIBSTDCXX_DIR}"
fi

ok "系统依赖就绪"

# ── Step 1: Python 虚拟环境 ──────────────────────────────────
info "[1/4] 配置 Python 虚拟环境..."

[[ -d "$VENV_DIR" ]] || python3 -m venv "$VENV_DIR"
source "${VENV_DIR}/bin/activate"
if [[ -n "$OFFLINE_DIR" && -d "${OFFLINE_DIR}/wheels" ]]; then
    pip install --quiet --no-index --find-links="${OFFLINE_DIR}/wheels" nanobind numpy pybind11
else
    pip install --quiet nanobind numpy pybind11
fi

ok "虚拟环境就绪: ${VENV_DIR}"

# ── Step 2+3: LLVM 克隆与编译 ───────────────────────────────
if [[ "$SKIP_LLVM" == false ]]; then
    # 克隆
    info "[2/4] 获取 LLVM 源码..."
    if [[ ! -d "${LLVM_DIR}/.git" ]]; then
        clone_flags=(--depth 1)
        [[ -n "$LLVM_TAG" ]] && clone_flags+=(--branch "$LLVM_TAG")
        git clone "${clone_flags[@]}" https://github.com/llvm/llvm-project.git "$LLVM_DIR"
        ok "克隆完成"
    else
        ok "已存在: ${LLVM_DIR}"
    fi

    # 编译
    info "[3/4] 编译 MLIR Python Binding..."
    mkdir -p "${LLVM_DIR}/build"
    cd "${LLVM_DIR}/build"

    if [[ ! -f "build.ninja" ]]; then
        # 收集 cmake 参数
        cmake_args=(
            -G Ninja ../llvm
            -DLLVM_ENABLE_PROJECTS=mlir
            -DLLVM_TARGETS_TO_BUILD=host
            -DCMAKE_BUILD_TYPE=Release
            -DMLIR_ENABLE_BINDINGS_PYTHON=ON
            -DPython3_EXECUTABLE="${VENV_PYTHON}"
            -DPython3_FIND_VIRTUALENV=ONLY
            -DLLVM_ENABLE_ASSERTIONS=ON
            -DCMAKE_INSTALL_PREFIX="${LLVM_DIR}/install"
        )

        # 编译器 / ninja（可选）
        [[ -n "$CC_BIN"    ]] && cmake_args+=(-DCMAKE_C_COMPILER="$CC_BIN")
        [[ -n "$CXX_BIN"   ]] && cmake_args+=(-DCMAKE_CXX_COMPILER="$CXX_BIN")
        [[ -n "$NINJA_BIN" ]] && cmake_args+=(-DCMAKE_MAKE_PROGRAM="$NINJA_BIN")

        # pybind11 / nanobind cmake 路径（从 venv 自动推导）
        _sp=$("${VENV_PYTHON}" -c "import site; print(site.getsitepackages()[0])")
        for _pkg in pybind11 nanobind; do
            _dir=$("${VENV_PYTHON}" -c "
import sys
try:
    if '$_pkg' == 'pybind11':
        import pybind11; print(pybind11.get_cmake_dir())
    else:
        import nanobind; print(nanobind.cmake_dir())
except Exception:
    pass
" 2>/dev/null)
            [[ -z "$_dir" ]] && _dir="${_sp}/${_pkg}/share/cmake/${_pkg}"
            [[ "$_pkg" == "nanobind" ]] && _dir="${_sp}/nanobind/cmake"
            if [[ -d "$_dir" ]]; then
                cmake_args+=(-D${_pkg}_DIR="$_dir")
                info "${_pkg} cmake dir: ${_dir}"
            fi
        done

        cmake "${cmake_args[@]}"
        ok "CMake 配置完成"
    else
        ok "CMake 已配置，跳过"
    fi

    cmake --build . --target MLIRPythonModules MLIRPythonCAPI -- -j"${JOBS}"
    ok "编译完成"
    cd "$SCRIPT_DIR"
else
    info "[2/4] 跳过 LLVM（--skip-llvm）"
    info "[3/4] 跳过编译（--skip-llvm）"
    if [[ ! -d "$MLIR_BINDING" ]]; then
        # 优先使用 bundle 中的本地编译 MLIR binding
        if [[ -n "$OFFLINE_DIR" && -f "${OFFLINE_DIR}/mlir_core.tar.gz" ]]; then
            info "从离线包解压本地 MLIR binding..."
            MLIR_BINDING="${BACKEND_DIR}/.mlir_core"
            rm -rf "$MLIR_BINDING" && mkdir -p "$MLIR_BINDING"
            tar -xzf "${OFFLINE_DIR}/mlir_core.tar.gz" -C "$MLIR_BINDING"
            ok "本地 MLIR binding 已解压: ${MLIR_BINDING}"
        else
            info "未找到自编译 MLIR binding，尝试安装 mlir-python-bindings..."
            _mlir_index="https://github.com/makslevental/mlir-wheels/releases/expanded_assets/latest"
            if [[ -n "$OFFLINE_DIR" ]] && ls "${OFFLINE_DIR}/wheels/mlir"* 2>/dev/null | grep -q .; then
                info "从离线包安装 mlir-python-bindings..."
                pip install --quiet --no-index --find-links="${OFFLINE_DIR}/wheels" mlir-python-bindings
            else
                info "从 mlir-wheels 安装 mlir-python-bindings..."
                pip install --quiet -f "$_mlir_index" mlir-python-bindings
            fi
            _pip_mlir=$("$VENV_PYTHON" -c "import mlir, os; print(os.path.dirname(mlir.__file__))" 2>/dev/null || true)
            if [[ -n "$_pip_mlir" ]]; then
                MLIR_BINDING="$_pip_mlir"
                ok "mlir-python-bindings 已安装: ${MLIR_BINDING}"
            else
                error "MLIR binding 安装失败，请手动指定 --llvm-dir 或安装 mlir-python-bindings"
            fi
        fi
    fi
fi

# ── Step 4a: 后端 ────────────────────────────────────────────
if [[ "$SKIP_BACKEND" == false ]]; then
    info "[4/4] 配置后端..."
    source "${VENV_DIR}/bin/activate"
    if [[ -n "$OFFLINE_DIR" && -d "${OFFLINE_DIR}/wheels" ]]; then
        pip install --quiet --no-index --find-links="${OFFLINE_DIR}/wheels" \
            fastapi "uvicorn[standard]" python-multipart pydantic pyyaml pytest httpx
    else
        pip install --quiet fastapi "uvicorn[standard]" python-multipart pydantic pyyaml pytest httpx
    fi

    # 将 MLIR binding 路径写入 activate（幂等）
    # 若 mlir 已 pip 安装进 venv site-packages，无需额外设置 PYTHONPATH
    if [[ "$MLIR_BINDING" != "${VENV_DIR}"* ]] && \
       ! grep -qF "$MLIR_BINDING" "${VENV_DIR}/bin/activate" 2>/dev/null; then
        printf '\n# MLIR binding (setup.sh)\nexport PYTHONPATH=%s:$PYTHONPATH\n' \
            "$MLIR_BINDING" >> "${VENV_DIR}/bin/activate"
    fi

    # 将 libstdc++ 路径写入 activate，使后端运行时也能加载正确版本
    # 解决 CXXABI_x.x.x / GLIBCXX_x.x.x not found 问题
    if [[ -n "$RESOLVED_LIBSTDCXX_DIR" ]] && \
       ! grep -qF "$RESOLVED_LIBSTDCXX_DIR" "${VENV_DIR}/bin/activate" 2>/dev/null; then
        printf '\n# libstdc++ compat (setup.sh)\nexport LD_LIBRARY_PATH=%s:${LD_LIBRARY_PATH:-}\n' \
            "$RESOLVED_LIBSTDCXX_DIR" >> "${VENV_DIR}/bin/activate"
        info "LD_LIBRARY_PATH 已写入 activate"
    fi

    # 验证（MLIR_BINDING 可能是自编译路径，也可能已在 venv site-packages 中）
    _verify_pythonpath=""
    [[ "$MLIR_BINDING" != "${VENV_DIR}"* ]] && _verify_pythonpath="$MLIR_BINDING"
    PYTHONPATH="${_verify_pythonpath}${_verify_pythonpath:+:}${PYTHONPATH:-}" \
    "${VENV_PYTHON}" -c "
import mlir.ir as ir
ctx = ir.Context()
ctx.allow_unregistered_dialects = True
m = ir.Module.parse('func.func @t() { return }', ctx)
assert m.operation.verify()
print('MLIR binding OK')
"
    ok "后端配置完成"
fi

# ── Step 4b: 前端 ────────────────────────────────────────────
if [[ "$SKIP_FRONTEND" == false ]]; then
    info "[4/4] 配置前端..."
    # 检查已安装的 vite 主版本是否与 package.json 一致
    # 避免旧版 node_modules（如 vite 7）与当前配置（vite 4）不匹配
    _need_install=true
    if [[ -d "${FRONTEND_DIR}/node_modules/.bin" ]]; then
        _installed=$(node -e "
try {
  const v = require('${FRONTEND_DIR}/node_modules/vite/package.json').version;
  process.stdout.write(v.split('.')[0]);
} catch(e) {}" 2>/dev/null || true)
        _required=$(node -e "
try {
  const v = require('${FRONTEND_DIR}/package.json').devDependencies.vite;
  process.stdout.write(v.replace(/[^0-9]/,'').charAt(0));
} catch(e) {}" 2>/dev/null || true)
        if [[ -n "$_installed" && "$_installed" == "$_required" ]]; then
            ok "前端依赖版本匹配（vite ${_installed}.x），跳过 npm install"
            _need_install=false
        else
            warn "vite 版本不匹配（已安装: ${_installed}.x，需要: ${_required}.x），重新安装..."
            rm -rf "${FRONTEND_DIR}/node_modules"
        fi
    fi

    if [[ "$_need_install" == true ]]; then
        if [[ -n "$OFFLINE_DIR" && -f "${OFFLINE_DIR}/node_modules.tar.gz" ]]; then
            info "离线模式：从 bundle 解压 node_modules..."
            tar -xzf "${OFFLINE_DIR}/node_modules.tar.gz" -C "$FRONTEND_DIR"
            ok "前端依赖已从离线包解压"
        else
            npm_args=(--prefix "$FRONTEND_DIR" install --legacy-peer-deps)
            [[ -n "$NPM_REGISTRY" ]] && npm_args+=(--registry "$NPM_REGISTRY")
            npm "${npm_args[@]}"
            ok "前端依赖安装完成"
        fi
    fi
fi

# ── 清理临时目录 ──────────────────────────────────────────────
[[ -n "$OFFLINE_DIR" ]] && rm -rf "$OFFLINE_DIR"

# ── 生成启动脚本 ──────────────────────────────────────────────
info "生成启动脚本..."

# start-backend.sh：source venv（PYTHONPATH/LD_LIBRARY_PATH 已写入 activate）
{
    echo '#!/usr/bin/env bash'
    echo 'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"'
    echo 'cd "${SCRIPT_DIR}/backend"'
    echo 'source .venv/bin/activate'
    echo 'exec uvicorn app.main:app --reload --port 8000'
} > "${SCRIPT_DIR}/start-backend.sh"
chmod +x "${SCRIPT_DIR}/start-backend.sh"

# start-frontend.sh：若用了 --node 则将其目录烘焙进 PATH
{
    echo '#!/usr/bin/env bash'
    if [[ -n "$NODE_BIN" ]]; then
        echo "export PATH=\"$(dirname "$NODE_BIN"):\$PATH\""
    fi
    echo 'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"'
    echo 'cd "${SCRIPT_DIR}/frontend"'
    echo 'exec npm run dev'
} > "${SCRIPT_DIR}/start-frontend.sh"
chmod +x "${SCRIPT_DIR}/start-frontend.sh"

ok "启动脚本已生成"

# ── 完成 ─────────────────────────────────────────────────────
echo ""
echo "=== 配置完成 ==="
echo ""
echo "启动后端:  ./start-backend.sh"
echo "启动前端:  ./start-frontend.sh"
if [[ "$MLIR_BINDING" != "${VENV_DIR}"* ]]; then
    echo "运行测试:  cd backend && PYTHONPATH=${MLIR_BINDING}:. .venv/bin/python3 -m pytest tests/ -v"
else
    echo "运行测试:  cd backend && .venv/bin/python3 -m pytest tests/ -v"
fi
echo ""
