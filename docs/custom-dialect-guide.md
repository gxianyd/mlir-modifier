# 导入自定义 Out-of-Tree Dialect

本文档介绍如何将自定义的 out-of-tree MLIR dialect 集成到 MLIR Modifier 中，使其 op 能在图编辑器中被创建和编辑。

## 概述

MLIR Modifier 的 dialect 支持分为两个层次：

| 层次 | 能力 | 要求 |
|------|------|------|
| **基础支持** | 加载、查看、编辑包含自定义 op 的 MLIR 文件 | 无需任何配置（`allow_unregistered_dialects = True`） |
| **完整支持** | 在图编辑器中创建新 op、查看 op 签名、自动补全 | 需要 Python binding + 注册到 dialect registry |

如果你只需要**查看和编辑**已有的自定义 dialect IR 文件，无需做任何配置——MLIR Modifier 默认开启 `allow_unregistered_dialects`，可以直接加载任意 MLIR 文本。

以下步骤适用于需要**完整支持**的场景。

## 前置条件

- 已按照 [setup-guide.md](setup-guide.md) 搭建好开发环境
- 已有一个可编译的 out-of-tree dialect（使用 ODS/TableGen 定义）
- LLVM/MLIR 源码及编译产物

## 步骤 1：为 Dialect 生成 Python Binding

### 1.1 在 CMakeLists.txt 中添加 Python binding 目标

在你的 dialect 的 `CMakeLists.txt` 中添加 Python binding 生成规则。假设你的 dialect 名为 `mydia`：

```cmake
# my-dialect/python/CMakeLists.txt

# 声明 Python binding 源文件
declare_mlir_python_sources(MyDialectPythonSources
  ROOT_DIR "${CMAKE_CURRENT_SOURCE_DIR}"
  ADD_TO_PARENT MLIRPythonSources.Dialects
  SOURCES
    MyDialect.py           # 手写的高层包装（可选）
)

# 从 ODS 自动生成 op binding
declare_mlir_python_sources(MyDialectPythonSources.ops_gen
  ROOT_DIR "${CMAKE_CURRENT_BINARY_DIR}"
  ADD_TO_PARENT MLIRPythonSources.Dialects
  SOURCES
    _mydia_ops_gen.py       # 自动生成的文件名
)

# 用 mlir-tblgen 生成 Python op binding
set(LLVM_TARGET_DEFINITIONS MyDialectOps.td)
mlir_tablegen(_mydia_ops_gen.py -gen-python-op-bindings
  -bind-dialect=mydia)
add_public_tablegen_target(MyDialectPythonOpsGen)
```

### 1.2 创建 dialect 入口模块（可选但推荐）

创建 `my-dialect/python/MyDialect.py`，作为 `mlir.dialects.mydia` 的入口：

```python
# MyDialect.py
from ._mydia_ops_gen import *  # noqa: F401,F403
```

### 1.3 编译生成 Python binding

```bash
cd /path/to/llvm-project/build
cmake --build . --target MyDialectPythonOpsGen
```

生成的 `_mydia_ops_gen.py` 内容类似：

```python
# 自动生成 — 不要手动编辑
from mlir.ir import *
from mlir._mlir_libs._mlir import register_dialect

class MyAddOp:
    OPERATION_NAME = "mydia.add"
    _ODS_REGIONS = (0, True)

    def __init__(self, result, lhs, rhs, *, loc=None, ip=None):
        ...
```

## 步骤 2：安装 Python Binding

将生成的 Python 文件放入 MLIR Python binding 的 `dialects` 包路径下。有两种方式：

### 方式 A：一键脚本（推荐）

使用项目提供的 `scripts/import-dialect.sh` 脚本，自动完成复制、注册、验证三步：

```bash
# 仅有 ops gen 文件（脚本会自动生成入口模块）
./scripts/import-dialect.sh mydia ./build/_mydia_ops_gen.py

# 同时提供入口模块
./scripts/import-dialect.sh mydia ./build/mydia.py ./build/_mydia_ops_gen.py
```

脚本会依次：
1. 将 binding 文件复制到 `$MLIR_PYTHON_ROOT/mlir/dialects/`
2. 若缺少 `mydia.py` 入口，自动从 `_mydia_ops_gen.py` 生成
3. 将 `"mydia"` 写入 `backend/app/services/dialect_registry.py` 的 `_BUILTIN_DIALECT_MODULES`
4. 运行验证，打印 op 列表和签名

完成后重启后端：`./start-backend.sh`

> 如需手动操作，参考下方"手动步骤"。

<details>
<summary>手动步骤（方式 A 原始命令）</summary>

```bash
MLIR_PYTHON_ROOT=/path/to/llvm-project/build/tools/mlir/python_packages/mlir_core

# 复制生成的文件
cp _mydia_ops_gen.py  $MLIR_PYTHON_ROOT/mlir/dialects/
cp MyDialect.py       $MLIR_PYTHON_ROOT/mlir/dialects/mydia.py
```

然后手动将 `"mydia"` 添加到 `backend/app/services/dialect_registry.py` 中的 `_BUILTIN_DIALECT_MODULES`。

</details>

### 方式 B：通过 PYTHONPATH 导入

如果你的 dialect 编译产物在单独目录中，可以将其加入 `PYTHONPATH`。需要确保目录结构为：

```
/path/to/my-dialect-python/
└── mlir/
    └── dialects/
        ├── mydia.py              # 入口模块
        └── _mydia_ops_gen.py     # 生成的 binding
```

然后设置环境变量：

```bash
export PYTHONPATH=/path/to/my-dialect-python:$PYTHONPATH
```

> **注意**：如果使用方式 B，要确保 `mlir/dialects/` 下有 `__init__.py`（或使用 namespace package），否则 Python 可能找不到模块。

### 验证安装

```bash
PYTHONPATH=/path/to/llvm-project/build/tools/mlir/python_packages/mlir_core \
python3 -c "
from mlir.dialects import mydia
print('Dialect module loaded')

# 检查 op 类是否存在
import inspect
for name, obj in inspect.getmembers(mydia, inspect.isclass):
    op_name = getattr(obj, 'OPERATION_NAME', None)
    if op_name:
        print(f'  Found op: {op_name}')
"
```

## 步骤 3：注册到 MLIR Modifier

使用方式 A 脚本时，此步骤已自动完成。

手动注册时，编辑 `backend/app/services/dialect_registry.py`，将 dialect 名添加到 `_BUILTIN_DIALECT_MODULES` 列表：

```python
_BUILTIN_DIALECT_MODULES: list[str] = [
    ...
    "tosa",
    "mydia",    # <-- 添加你的 dialect
]
```

注册后，MLIR Modifier 会自动：
- 在 **dialect 列表** (`GET /api/dialects`) 中显示 `mydia`
- 在 **op 列表** (`GET /api/dialect/mydia/ops`) 中列出所有带 `OPERATION_NAME` 的 op
- 在 **op 签名** (`GET /api/op/mydia.add/signature`) 中提取参数信息
- 在前端 **Op Creator** 面板中允许创建 `mydia.*` 的 op

## 步骤 4：验证集成

### 4.1 后端验证

```bash
cd backend
PYTHONPATH=/path/to/llvm-project/build/tools/mlir/python_packages/mlir_core:. \
.venv/bin/python3 -c "
from app.services.dialect_registry import list_dialects, list_ops, get_op_signature

# 检查 dialect 是否可用
dialects = list_dialects()
print(f'Available dialects: {dialects}')
assert 'mydia' in dialects, 'mydia not found!'

# 检查 op 列表
ops = list_ops('mydia')
print(f'Ops in mydia: {[o.name for o in ops]}')

# 检查 op 签名
sig = get_op_signature('mydia.add')
if sig:
    print(f'mydia.add params: {[(p.name, p.kind) for p in sig.params]}')
    print(f'mydia.add results: {sig.num_results}')
"
```

### 4.2 前端验证

1. 启动后端和前端
2. 加载一个包含自定义 dialect op 的 `.mlir` 文件
3. 点击工具栏 "Add Op" 按钮，在 dialect 下拉菜单中应能看到 `mydia`
4. 选择 `mydia` 后应能看到其下的 op 列表

### 4.3 测试自定义 op 的 MLIR 文件

即使没有 Python binding，也可以直接加载包含自定义 op 的 MLIR 文件：

```mlir
// test_mydia.mlir
module {
  func.func @test(%arg0: f32, %arg1: f32) -> f32 {
    %0 = "mydia.add"(%arg0, %arg1) : (f32, f32) -> f32
    return %0 : f32
  }
}
```

> 注意使用通用语法 `"mydia.add"(...)` 而非 pretty-print 语法，因为未注册 dialect 的 op 只能用通用语法。

## 无 Python Binding 的简化方案

如果你不需要在编辑器中**创建**自定义 op（只需查看和编辑），可以跳过 Python binding 生成。MLIR Modifier 的 `allow_unregistered_dialects = True` 设置允许加载任意 dialect 的 IR，你可以：

- 加载、查看包含自定义 op 的 IR 图
- 编辑 op 的属性
- 修改 op 间的连接关系
- 删除自定义 op
- 通过 undo/redo 撤销操作

唯一不支持的是通过 Op Creator 面板创建新的自定义 op（因为没有签名信息）。

## 常见问题

### Q: `importlib.import_module('mlir.dialects.mydia')` 报 ModuleNotFoundError

检查：
1. `_mydia_ops_gen.py` 是否在 `mlir/dialects/` 目录下
2. 是否有 `mydia.py` 入口文件（或直接将 `_mydia_ops_gen.py` 重命名为 `mydia.py`）
3. `PYTHONPATH` 是否正确设置

### Q: Op 出现在列表中但签名为空

这通常是 `__init__` 签名解析问题。检查你的 ODS 定义是否正确声明了 operand 和 result 类型。`mlir-tblgen -gen-python-op-bindings` 生成的 `__init__` 需要包含类型化的参数。

### Q: 加载包含自定义 op 的文件时报 verification 错误

如果 dialect 未注册到 context 中，MLIR 无法 verify 自定义 op 的语义约束（但解析可以成功）。Verification 错误会显示在编辑器的 validation banner 中，不影响查看和编辑。

如需 verify 正确工作，需要将 dialect 的 C++ 实现编译为共享库，并通过 `context.load_dialect('mydia')` 注册。这需要额外的 CMake 配置，超出本文档范围。
