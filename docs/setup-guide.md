# MLIR Modifier 环境配置指南

本文档介绍如何从零搭建 MLIR Modifier 的开发和运行环境。

## 系统要求

- **操作系统**: Linux (Ubuntu 24.04 已验证)
- **CPU**: 多核推荐（编译 MLIR 较耗时，20 核约需 10-15 分钟）
- **内存**: 16GB+
- **磁盘**: 至少 30GB 可用空间（LLVM 源码 + 编译产物约 20GB）
- **Python**: 3.10+
- **Node.js**: 18+

## 1. 安装系统依赖

```bash
sudo apt-get update
sudo apt-get install -y cmake ninja-build gcc g++ git
```

验证：

```bash
cmake --version    # 需要 3.20+
ninja --version
gcc --version
g++ --version
```

## 2. 编译 MLIR Python Binding

MLIR Python binding 不提供预编译 pip 包，需要从 LLVM 源码编译。

### 2.1 创建 Python 虚拟环境

```bash
cd mlir-modifier/backend
python3 -m venv .venv
source .venv/bin/activate
```

### 2.2 安装 Python 编译依赖

```bash
pip install nanobind numpy pybind11
```

> **注意**: 新版 MLIR (main 分支) 已从 pybind11 迁移到 nanobind，必须安装 nanobind。

### 2.3 克隆 LLVM 源码

```bash
# shallow clone 减少下载量（约 2GB）
git clone --depth 1 https://github.com/llvm/llvm-project.git /path/to/llvm-project
```

如需特定版本（如 LLVM 19），可指定 tag：

```bash
git clone --depth 1 --branch llvmorg-19.1.0 https://github.com/llvm/llvm-project.git /path/to/llvm-project
```

### 2.4 CMake 配置

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

### 2.5 编译

```bash
# 编译 Python binding 及其依赖（使用所有可用核心）
cmake --build . --target MLIRPythonModules MLIRPythonCAPI -- -j$(nproc)
```

编译完成后，Python binding 位于：

```
build/tools/mlir/python_packages/mlir_core/
└── mlir/
    ├── __init__.py
    ├── ir.py
    ├── _mlir_libs/
    │   ├── _mlir.cpython-3xx-xxx.so
    │   └── ...
    └── dialects/
        ├── arith.py
        ├── func.py
        └── ...
```

### 2.6 验证

```bash
source /path/to/mlir-modifier/backend/.venv/bin/activate

PYTHONPATH=/path/to/llvm-project/build/tools/mlir/python_packages/mlir_core \
python3 -c "
import mlir.ir as ir
print('MLIR Python binding loaded successfully')

ctx = ir.Context()
ctx.allow_unregistered_dialects = True

module = ir.Module.parse('''
func.func @test(%arg0: f32, %arg1: f32) -> f32 {
  %0 = arith.addf %arg0, %arg1 : f32
  return %0 : f32
}
''', ctx)

print(f'Module op: {module.operation.name}')
print(f'Verify: {module.operation.verify()}')
print('All checks passed!')
"
```

预期输出：

```
MLIR Python binding loaded successfully
Module op: builtin.module
Verify: True
All checks passed!
```

## 3. 配置后端

### 3.1 安装 Python 依赖

```bash
cd mlir-modifier/backend
source .venv/bin/activate
pip install fastapi "uvicorn[standard]" python-multipart pydantic pyyaml
```

### 3.2 设置 PYTHONPATH

将 MLIR Python binding 路径加入环境变量。建议在 `.venv/bin/activate` 末尾追加：

```bash
echo 'export PYTHONPATH=/path/to/llvm-project/build/tools/mlir/python_packages/mlir_core:$PYTHONPATH' \
  >> .venv/bin/activate
```

### 3.3 启动后端

```bash
cd mlir-modifier/backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

验证：访问 `http://localhost:8000/api/health` 应返回 `{"status": "ok"}`

## 4. 配置前端

```bash
cd mlir-modifier/frontend
npm install
npm run dev
```

前端默认运行在 `http://localhost:5173`，连接后端 `http://localhost:8000`。

## 5. MLIR Python Binding API 注意事项

在开发过程中需要注意以下 MLIR Python binding 的特性：

### 5.1 对象 wrapper 不稳定

MLIR Python binding 每次访问属性（如 `op.regions`、`op.results`）都会创建新的 Python wrapper 对象，`id()` 不稳定，不能用 `id()` 做对象标识。

```python
# 错误：id() 不可靠
r1 = list(op.regions)[0]
r2 = list(op.regions)[0]
assert id(r1) == id(r2)  # 会失败！

# 正确：使用 == 比较
assert r1 == r2  # OK，比较底层 C++ 指针
```

### 5.2 OpView vs Operation

`block.operations` 迭代得到的是 `OpView` 子类（如 `FuncOp`、`ReturnOp`），不是 `Operation`。

- `OpView.name` — 返回 `sym_name` 属性（`StringAttr`），如 `"my_func"`
- `OpView.operation.name` — 返回 op 类型名（`str`），如 `func.func`

开发中应统一使用 `.operation` 获取底层 `Operation` 对象：

```python
for op_view in block.operations:
    op = op_view.operation  # 获取 Operation
    print(op.name)          # "arith.addf" (str)
```

### 5.3 属性迭代

`Operation.attributes` 是 dict-like 的 `OpAttributeMap`，迭代得到 key 字符串：

```python
for attr_name in op.attributes:       # attr_name 是 str
    attr_val = op.attributes[attr_name]  # 获取 Attribute 对象
```

### 5.4 Value 类型

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

### CMake 找不到 nanobind

```
CMake Error: not found (install via 'pip install nanobind' or set nanobind_DIR)
```

确保在 venv 中安装了 nanobind，且 `Python3_EXECUTABLE` 指向 venv Python。

### CMake 找到系统 Python 而非 venv Python

添加 `-DPython3_FIND_VIRTUALENV=ONLY` 参数，并确认 `-DPython3_EXECUTABLE` 路径正确。

### 编译时内存不足

减少并行数：`-j4` 代替 `-j$(nproc)`。Release 构建比 Debug 占用更少内存。

### import mlir 报错 ModuleNotFoundError

检查 `PYTHONPATH` 是否包含 `build/tools/mlir/python_packages/mlir_core` 路径。
