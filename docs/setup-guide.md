# MLIR Modifier 环境配置指南

## 一键配置

在项目根目录运行：

```bash
./setup.sh
```

脚本会自动完成：系统依赖检查、Python 虚拟环境创建、LLVM 源码克隆、MLIR Python Binding 编译、后端/前端依赖安装、PYTHONPATH 配置。

### 常用选项

```bash
./setup.sh --help                                 # 查看帮助
./setup.sh --llvm-dir /path/to/llvm-project       # 使用已有 LLVM 源码
./setup.sh --llvm-tag llvmorg-19.1.0              # 指定 LLVM 版本
./setup.sh --skip-llvm                            # 跳过 LLVM 编译（已编译过）
./setup.sh --skip-frontend                        # 只配置后端
./setup.sh --jobs 4                               # 限制编译并行数（内存不足时）
./setup.sh --cxx /opt/rh/devtoolset-9/root/usr/bin/g++   # HPC：指定更新的编译器
./setup.sh --libstdcxx-dir /opt/gcc-9/lib64       # 手动指定 libstdc++ 目录
```

### 配置完成后

启动后端：

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

启动前端：

```bash
cd frontend
npm run dev
```

验证：访问 `http://localhost:8000/api/health` 应返回 `{"status": "ok"}`，前端运行在 `http://localhost:5173`。

## 系统要求

- **操作系统**: Linux (Ubuntu 24.04 已验证)
- **CPU**: 多核推荐（编译 MLIR 较耗时，20 核约需 10-15 分钟）
- **内存**: 16GB+
- **磁盘**: 至少 30GB 可用空间（LLVM 源码 + 编译产物约 20GB）
- **Python**: 3.10+
- **Node.js**: 14.18+（推荐 16+，vite 4 ESM 要求 >= 14.18）

## 手动配置参考

如需手动配置或排查问题，以下是各步骤的详细说明。

### 1. 安装系统依赖

```bash
sudo apt-get update
sudo apt-get install -y cmake ninja-build gcc g++ git
```

### 2. 编译 MLIR Python Binding

#### 2.1 创建 Python 虚拟环境

```bash
cd mlir-modifier/backend
python3 -m venv .venv
source .venv/bin/activate
```

#### 2.2 安装 Python 编译依赖

```bash
pip install nanobind pybind11
```

> **注意**: 新版 MLIR (main 分支) 已从 pybind11 迁移到 nanobind，必须安装 nanobind。

#### 2.3 克隆 LLVM 源码

```bash
git clone --depth 1 https://github.com/llvm/llvm-project.git /path/to/llvm-project
```

#### 2.4 CMake 配置

```bash
cd /path/to/llvm-project
mkdir build && cd build

cmake -G Ninja ../llvm \
  -DLLVM_ENABLE_PROJECTS=mlir \
  -DLLVM_TARGETS_TO_BUILD="host" \
  -DCMAKE_BUILD_TYPE=Release \
  -DMLIR_ENABLE_BINDINGS_PYTHON=ON \
  -DPython3_EXECUTABLE=/path/to/mlir-modifier/backend/.venv/bin/python3 \
  -DPython3_FIND_VIRTUALENV=ONLY \
  -Dpybind11_DIR=$(python3 -c "import pybind11; print(pybind11.get_cmake_dir())") \
  -Dnanobind_DIR=$(python3 -c "import nanobind; print(nanobind.cmake_dir())") \
  -DLLVM_ENABLE_ASSERTIONS=ON \
  -DCMAKE_INSTALL_PREFIX=../install
```

**关键参数说明**:

| 参数 | 说明 |
|------|------|
| `LLVM_ENABLE_PROJECTS=mlir` | 只编译 MLIR 子项目 |
| `LLVM_TARGETS_TO_BUILD="host"` | 只编译当前平台 target，减少编译量 |
| `CMAKE_BUILD_TYPE=Release` | Release 构建，减少产物大小 |
| `MLIR_ENABLE_BINDINGS_PYTHON=ON` | 启用 Python binding |
| `Python3_EXECUTABLE=...` | 指向 venv 中的 Python，确保 binding 与项目环境一致 |
| `Python3_FIND_VIRTUALENV=ONLY` | 强制使用 venv Python，避免找到系统 Python |

#### 2.5 编译

```bash
cmake --build . --target MLIRPythonModules MLIRPythonCAPI -- -j$(nproc)
```

#### 2.6 设置 PYTHONPATH

将 MLIR Python binding 路径加入环境变量。建议在 `.venv/bin/activate` 末尾追加：

```bash
echo 'export PYTHONPATH=/path/to/llvm-project/build/tools/mlir/python_packages/mlir_core:$PYTHONPATH' \
  >> .venv/bin/activate
```

### 3. 安装后端依赖

```bash
cd mlir-modifier/backend
source .venv/bin/activate
pip install fastapi "uvicorn[standard]" python-multipart pydantic pyyaml
```

### 4. 安装前端依赖

```bash
cd mlir-modifier/frontend
npm install
```

## MLIR Python Binding API 注意事项

### 对象 wrapper 不稳定

MLIR Python binding 每次访问属性（如 `op.regions`、`op.results`）都会创建新的 Python wrapper 对象，`id()` 不稳定，不能用 `id()` 做对象标识。

```python
# 错误：id() 不可靠
r1 = list(op.regions)[0]
r2 = list(op.regions)[0]
assert id(r1) == id(r2)  # 会失败！

# 正确：使用 == 比较
assert r1 == r2  # OK，比较底层 C++ 指针
```

### OpView vs Operation

`block.operations` 迭代得到的是 `OpView` 子类（如 `FuncOp`、`ReturnOp`），不是 `Operation`。

- `OpView.name` — 返回 `sym_name` 属性（`StringAttr`），如 `"my_func"`
- `OpView.operation.name` — 返回 op 类型名（`str`），如 `func.func`

开发中应统一使用 `.operation` 获取底层 `Operation` 对象：

```python
for op_view in block.operations:
    op = op_view.operation  # 获取 Operation
    print(op.name)          # "arith.addf" (str)
```

### 属性迭代

`Operation.attributes` 是 `OpAttributeMap`。迭代得到的是 `NamedAttribute` 对象（不是字符串），
需要通过 `.name` 和 `.attr` 访问键值：

```python
for named_attr in op.attributes:
    attr_name = named_attr.name   # str：属性名
    attr_val  = named_attr.attr   # MlirAttribute：属性值
```

也可以用整数下标访问：`op.attributes[0]` 返回 `NamedAttribute`；
用字符串下标访问：`op.attributes["sym_name"]` 返回 `MlirAttribute`。

### Value 类型

operand 的具体类型可以用 `isinstance` 区分：

```python
import mlir.ir as ir

for operand in op.operands:
    if isinstance(operand, ir.OpResult):
        print(f"来自 op {operand.owner.name} 的第 {operand.result_number} 个结果")
    elif isinstance(operand, ir.BlockArgument):
        print(f"block 参数第 {operand.arg_number} 个")
```

## 常见问题

### CMake 找不到 pybind11 / nanobind

```
Could not find a package configuration file provided by "pybind11"
```

CMake 无法自动从 venv 中找到 cmake 配置文件，需要显式传入路径：

```bash
# 激活 venv 后执行
-Dpybind11_DIR=$(python3 -c "import pybind11; print(pybind11.get_cmake_dir())")
-Dnanobind_DIR=$(python3 -c "import nanobind; print(nanobind.cmake_dir())")
```

`setup.sh` 会自动处理此问题。

### GLIBCXX_3.4.xx not found

```
/lib64/libstdc++.so.6: version `GLIBCXX_3.4.20' not found
```

HPC 集群或旧版 Linux（如 CentOS 7）上，编译器比系统 `/lib64/libstdc++.so.6` 版本新，编译产物（如 `llvm-min-tblgen`）运行时找不到对应符号。

`setup.sh` 会自动检测并设置 `LD_LIBRARY_PATH`，也可手动指定：

```bash
# 方式一：指定编译器，脚本自动推导 libstdc++ 路径
./setup.sh --cxx /opt/rh/devtoolset-9/root/usr/bin/g++

# 方式二：直接指定 libstdc++ 所在目录
./setup.sh --libstdcxx-dir /opt/rh/devtoolset-9/root/usr/lib/gcc/x86_64-redhat-linux/9
```

手动临时修复（不重新编译）：

```bash
export LD_LIBRARY_PATH=/path/to/newer/gcc/lib64:$LD_LIBRARY_PATH
```

### CMake 找到系统 Python 而非 venv Python

添加 `-DPython3_FIND_VIRTUALENV=ONLY` 参数，并确认 `-DPython3_EXECUTABLE` 路径正确。

### 编译时内存不足

减少并行数：`./setup.sh --jobs 4` 或手动使用 `-j4` 代替 `-j$(nproc)`。Release 构建比 Debug 占用更少内存。

### import mlir 报错 ModuleNotFoundError

检查 `PYTHONPATH` 是否包含 `build/tools/mlir/python_packages/mlir_core` 路径。

### SyntaxError: Unexpected token import（启动前端时）

```
SyntaxError: Unexpected token import
```

vite 4 使用 ESM 语法，要求 Node.js >= 14.18。HPC 上系统默认 node 可能过旧，即使用
Node 16 的 `npm run dev`，vite 的入口脚本（`#!/usr/bin/env node`）仍会从 PATH 中找到
旧版 node。

解决方法：在 `PATH` 前加入 Node 16 目录，再运行 vite：

```bash
export PATH=/swwork/hbcc/commontools/nodejs/16.16.0/bin:$PATH
cd frontend && npm run dev
```

或在运行 setup.sh 时传入 `--node`，脚本完成后会自动打印包含正确 PATH 的启动命令：

```bash
./setup.sh --skip-llvm --node /swwork/hbcc/commontools/nodejs/16.16.0/bin/node
```

### CORS 报错：No 'Access-Control-Allow-Origin' header

前端以 `http://127.0.0.1:5173` 访问后端时，浏览器认为与 `http://localhost:8000` 跨域。
后端 [backend/app/main.py](../backend/app/main.py) 的 `allow_origins` 已同时包含
`localhost:5173` 和 `127.0.0.1:5173`，确保两种访问方式均可正常工作。
