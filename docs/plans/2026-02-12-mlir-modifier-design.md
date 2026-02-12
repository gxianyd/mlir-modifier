# MLIR Modifier — 可视化编辑工具设计文档

## 1. 概述

MLIR Modifier 是一个类似 Netron 的 MLIR 可视化编辑工具。与 Netron 只读可视化不同，本工具支持对 MLIR IR 的交互式编辑，包括加载 MLIR 模型、可视化显示、删除 Op、添加 Op、修改 Op 属性等功能。

为保证模型解析和修改过程的正确性，Op 的定义信息获取以及 Op 的创建、修改、删除等操作全部通过 MLIR Python binding 实现。

### 核心特性

- 加载和解析任意 `.mlir` 文件
- Netron 风格的图可视化展示
- 支持删除 Op、创建 Op、修改 Op 属性、修改连接关系
- 实时 IR 合法性验证
- Undo/Redo 操作历史
- 支持任意内置 dialect 及 out-of-tree 自定义 dialect

---

## 2. 整体架构

采用前后端分离架构。

### 前端（React + TypeScript）

- 使用 React Flow 作为图可视化和交互的基础库，支持节点拖拽、连线、分组嵌套
- 右侧属性面板用于编辑选中 Op 的属性
- 通过 REST API + WebSocket 与后端通信：REST 用于加载/保存等请求-响应操作，WebSocket 用于实时验证结果推送

### 后端（Python FastAPI）

- 核心依赖 MLIR Python binding（`mlir-python-bindings`），所有 IR 操作（解析、创建 Op、修改属性、验证）都通过 binding 执行，保证正确性
- 维护当前编辑中的 IR 状态（in-memory `Module` 对象）
- 提供 dialect/op 注册信息查询接口，支持动态加载 out-of-tree dialect 的 `.so`/`.py` 插件
- Undo/Redo 通过操作历史栈（Command 模式）实现

### 关键数据流

```
用户操作 → 前端发送编辑请求 → 后端执行 MLIR binding 操作
→ 后端验证 → 返回更新后的 IR 结构 + 验证结果 → 前端更新视图
```

---

## 3. 前端展示风格（Netron 风格）

### 节点（Op）样式

- 每个 Op 渲染为圆角矩形卡片，顶部深色标题栏显示 Op 名称（如 `arith.addf`），下方浅色区域列出关键属性
- 输入/输出端口用小圆点显示在节点上下两侧，端口旁标注 tensor 类型信息（如 `tensor<2x3xf32>`）
- 节点配色按 dialect 分组着色（如 arith 蓝色系、linalg 绿色系），便于视觉区分

### 连线

- SSA value 的 def-use 关系用贝塞尔曲线连接，线上可标注数据类型
- 连线颜色跟随数据类型或源节点 dialect 颜色

### 布局

- 默认自上而下（top-to-bottom）的 DAG 布局，使用 dagre 或 ELK 自动排列
- 支持缩放、平移、框选

### 嵌套结构（混合模式）

- 带 region 的 Op（如 `scf.for`、`func.func`）渲染为可展开的容器框，浅灰色背景，内部包含子图
- 浅层（1-2 层）默认展开显示，更深层折叠，显示折叠图标，双击进入独立视图，顶部面包屑导航回退

### 属性面板（右侧）

- 选中节点后显示完整属性列表，每个属性可内联编辑
- 显示 Op 的输入输出类型签名、所属 dialect、region 信息

---

## 4. 后端 API 设计

### 模型加载与导出

- `POST /api/model/load` — 上传 `.mlir` 文件，后端通过 `mlir.ir.Module.parse()` 解析，返回整个 IR 的结构化 JSON
- `POST /api/model/save` — 将当前内存中的 Module 通过 `str(module)` 序列化，返回 `.mlir` 文件下载
- `POST /api/dialect/load` — 加载 out-of-tree dialect 的 `.so` 共享库或 Python 扩展

### Op 编辑操作

- `DELETE /api/op/{op_id}` — 删除指定 Op，后端处理 use-chain 断开
- `POST /api/op/create` — 创建新 Op（详见创建流程）
- `PATCH /api/op/{op_id}/attributes` — 修改 Op 属性值
- `PATCH /api/op/{op_id}/operands` — 修改 Op 的输入连接关系

### 查询接口

- `GET /api/dialects` — 列出已注册的所有 dialect
- `GET /api/dialect/{name}/ops` — 列出某个 dialect 下所有可用的 Op 定义（名称、属性模板、输入输出类型约束）

### 实时验证（WebSocket）

- 每次编辑操作执行后，后端自动调用 `module.operation.verify()`，通过 WebSocket 推送验证结果（通过/失败及错误信息）

### Undo/Redo

- `POST /api/undo` — 撤销上一步
- `POST /api/redo` — 重做
- `GET /api/history` — 返回操作历史列表

---

## 5. 创建 Op 的交互流程

### 步骤

1. 用户右键空白区域或点击工具栏 "Add Op"
2. 弹出选择面板，先选择 dialect（从 `GET /api/dialects` 获取列表）
3. 选定 dialect 后，展示该 dialect 下的 Op 列表（从 `GET /api/dialect/{name}/ops` 获取），支持搜索过滤
4. 选定 Op type 后，弹出属性填写表单 — 根据该 Op 的定义动态生成（必填属性、可选属性、输入输出类型）
5. 用户填写完成后，`POST /api/op/create` 发送完整信息，后端通过 MLIR binding 创建 Op
6. 创建成功后前端在图中渲染新节点，用户拖拽连线建立数据流关系

### 创建请求体

```json
{
  "dialect": "arith",
  "op_type": "addf",
  "attributes": {"fastmath": "none"},
  "operands": ["value_id_1", "value_id_2"],
  "result_types": ["f32"],
  "insert_point": {"block_id": "block_0", "position": 3}
}
```

---

## 6. Undo/Redo 与状态管理

### 实现方式：Command 模式

每次编辑操作封装为一个 Command 对象，包含 `execute()` 和 `undo()` 两个方法。后端维护两个栈：

- **undo 栈** — 每次执行新操作时压入
- **redo 栈** — 每次 undo 时压入，执行新操作时清空

### Command 类型

- `DeleteOpCommand` — execute: 删除 Op 并记录其完整状态（属性、连接关系、位置）；undo: 重建 Op 并恢复连接
- `CreateOpCommand` — execute: 创建 Op；undo: 删除该 Op
- `ModifyAttrCommand` — execute: 修改属性并记录旧值；undo: 恢复旧值
- `ModifyOperandCommand` — execute: 修改连接并记录旧连接；undo: 恢复旧连接

### 快捷键

- `Ctrl+Z` — Undo
- `Ctrl+Shift+Z` — Redo

---

## 7. Out-of-Tree Dialect 支持

### 加载方式

用户通过 UI 的设置页面或启动时配置文件指定要加载的外部 dialect：

- **共享库方式** — 指定 `.so` 文件路径，后端通过 `mlir._mlir_libs` 机制加载，将 dialect 注册到 MLIRContext
- **Python 扩展方式** — 指定 Python 模块路径，后端 `import` 该模块完成 dialect 注册

### 配置文件（`~/.mlir-modifier/config.yaml`）

```yaml
dialects:
  - type: shared_library
    path: /path/to/libMyDialect.so
  - type: python_module
    module: my_dialect.python_bindings
```

### API

- `POST /api/dialect/load` — 动态加载单个 dialect，传入类型和路径
- `GET /api/dialects` — 返回结果中包含外部加载的 dialect，与内置 dialect 无差别

### 错误处理

- 加载失败时返回明确错误信息（如 `.so` 版本不兼容、符号缺失等）

---

## 8. 自定义 Dialect 接入指南

本节提供一个完整的端到端示例，说明如何将自定义 dialect 接入 MLIR Modifier 工具。

### 8.1 前置条件

- LLVM/MLIR 已编译安装（需与 mlir-modifier 后端使用的 `mlir-python-bindings` 版本一致）
- CMake 3.20+
- Python 3.10+
- pybind11

### 8.2 假设已有的 Dialect 定义

假设你有一个名为 `mydialect` 的自定义 dialect，目录结构如下：

```
my-dialect/
├── include/
│   └── MyDialect/
│       ├── MyDialect.td           # Dialect 定义
│       ├── MyDialectOps.td        # Op 定义
│       └── CMakeLists.txt
├── lib/
│   └── MyDialect/
│       ├── MyDialect.cpp          # Dialect 注册实现
│       ├── MyDialectOps.cpp       # Op 实现
│       └── CMakeLists.txt
└── CMakeLists.txt
```

其中 `MyDialectOps.td` 定义了你的 Op：

```tablegen
// MyDialectOps.td
include "mlir/IR/OpBase.td"
include "MyDialect/MyDialect.td"

def MyDialect_AddOp : MyDialect_Op<"add", [Pure]> {
  let summary = "element-wise addition";
  let arguments = (ins AnyTensor:$lhs, AnyTensor:$rhs);
  let results = (outs AnyTensor:$result);
}

def MyDialect_ReluOp : MyDialect_Op<"relu", [Pure]> {
  let summary = "relu activation";
  let arguments = (ins AnyTensor:$input);
  let results = (outs AnyTensor:$output);
}
```

### 8.3 添加 Python Binding

在项目中添加 Python binding 目录：

```
my-dialect/
├── ...（已有文件）
└── python/
    ├── CMakeLists.txt
    ├── MyDialectModule.cpp        # pybind11 绑定入口
    └── my_dialect/
        └── __init__.py
```

#### 8.3.1 生成 Python Op 绑定代码

在 `python/CMakeLists.txt` 中配置 TableGen 生成和编译：

```cmake
# python/CMakeLists.txt

# 1. 从 ODS 定义生成 Python binding C++ 代码
set(LLVM_TARGET_DEFINITIONS ${CMAKE_SOURCE_DIR}/include/MyDialect/MyDialectOps.td)
mlir_tablegen(MyDialectOpsGen.py.cpp
  -gen-python-op-bindings
  -bind-dialect=my_dialect)
add_public_tablegen_target(MyDialectPythonOpsGenIncGen)

# 2. 生成 Dialect Python 包装
mlir_tablegen(MyDialectGen.py.cpp
  -gen-python-dialect-bindings
  -bind-dialect=my_dialect)
add_public_tablegen_target(MyDialectPythonDialectGenIncGen)
```

#### 8.3.2 编写 pybind11 绑定入口

```cpp
// python/MyDialectModule.cpp
#include "mlir-c/IR.h"
#include "mlir/Bindings/Python/PybindAdaptors.h"
#include "MyDialect/MyDialect.h"

PYBIND11_MODULE(_myDialect, m) {
  m.doc() = "MyDialect Python binding";

  // 注册 Dialect 到 Context
  m.def(
      "register_dialect",
      [](MlirContext context, bool load) {
        MlirDialectHandle handle = mlirGetDialectHandle__my_dialect__();
        mlirDialectHandleRegisterDialect(handle, context);
        if (load) {
          mlirDialectHandleLoadDialect(handle, context);
        }
      },
      py::arg("context"),
      py::arg("load") = true);
}
```

#### 8.3.3 编译为 Python 模块

在 `python/CMakeLists.txt` 中继续添加：

```cmake
# 3. 编译 pybind11 模块
pybind11_add_module(_myDialect
  MyDialectModule.cpp
  ${CMAKE_CURRENT_BINARY_DIR}/MyDialectOpsGen.py.cpp
  ${CMAKE_CURRENT_BINARY_DIR}/MyDialectGen.py.cpp)

target_include_directories(_myDialect PRIVATE
  ${CMAKE_SOURCE_DIR}/include
  ${MLIR_INCLUDE_DIRS})

target_link_libraries(_myDialect PRIVATE
  MLIRIR
  MLIRPythonCAPI
  MyDialectLib)   # 你的 dialect C++ 库

# 安装到 Python 包目录
install(TARGETS _myDialect
  LIBRARY DESTINATION python/my_dialect)
```

#### 8.3.4 编写 Python 包 `__init__.py`

```python
# python/my_dialect/__init__.py
from ._myDialect import register_dialect

def load(context):
    """将 my_dialect 注册并加载到给定的 MLIRContext 中"""
    register_dialect(context, load=True)
```

### 8.4 编译

```bash
cd my-dialect
mkdir build && cd build

cmake .. \
  -DMLIR_DIR=/path/to/llvm-project/build/lib/cmake/mlir \
  -DLLVM_DIR=/path/to/llvm-project/build/lib/cmake/llvm \
  -Dpybind11_DIR=$(python -c "import pybind11; print(pybind11.get_cmake_dir())") \
  -DCMAKE_INSTALL_PREFIX=./install

make -j$(nproc)
make install
```

编译完成后产物结构：

```
install/python/my_dialect/
├── __init__.py
└── _myDialect.cpython-310-x86_64-linux-gnu.so
```

### 8.5 验证

```python
# 测试 dialect 是否正确加载
import sys
sys.path.insert(0, "/path/to/install/python")

import mlir.ir as ir
import my_dialect

ctx = ir.Context()
my_dialect.load(ctx)

# 解析包含自定义 Op 的 MLIR
module = ir.Module.parse("""
  func.func @test(%arg0: tensor<2x3xf32>, %arg1: tensor<2x3xf32>) -> tensor<2x3xf32> {
    %0 = my_dialect.add %arg0, %arg1 : tensor<2x3xf32>
    %1 = my_dialect.relu %0 : tensor<2x3xf32>
    return %1 : tensor<2x3xf32>
  }
""", ctx)

print(module)
```

### 8.6 接入 MLIR Modifier

dialect 编译验证通过后，在工具配置文件中注册：

```yaml
# ~/.mlir-modifier/config.yaml
dialects:
  - type: python_module
    module: my_dialect
    path: /path/to/install/python    # 添加到 Python 搜索路径
```

或者在 UI 中：设置 → Dialect 管理 → 添加 → 选择 "Python Module" → 填写模块名和路径。

加载成功后，`my_dialect` 下的 `add`、`relu` 等 Op 将出现在创建 Op 的 dialect 选择列表中，与内置 dialect 操作方式完全一致。

---

## 9. IR 结构化数据格式

后端解析 MLIR 后，将 IR 转换为 JSON 传给前端渲染。

### 数据结构

```json
{
  "module_id": "module_0",
  "operations": [
    {
      "op_id": "op_001",
      "name": "arith.addf",
      "dialect": "arith",
      "attributes": {
        "fastmath": {"type": "FastMathFlags", "value": "none"}
      },
      "operands": [
        {"value_id": "v_01", "type": "f32"}
      ],
      "results": [
        {"value_id": "v_02", "type": "f32"}
      ],
      "regions": [],
      "parent_block": "block_0",
      "position": 2
    }
  ],
  "blocks": [
    {
      "block_id": "block_0",
      "arguments": [
        {"value_id": "v_00", "type": "f32"}
      ],
      "parent_region": "region_0"
    }
  ],
  "regions": [
    {
      "region_id": "region_0",
      "parent_op": "op_000"
    }
  ],
  "edges": [
    {"from_value": "v_01", "to_op": "op_001", "to_operand_index": 0}
  ]
}
```

### 要点

- 每个 SSA value 有唯一 `value_id`，作为连线的依据
- Op、Block、Region 都有唯一 ID，后端维护 ID 与 MLIR 对象的映射
- 前端根据 `regions` 的嵌套关系决定分层展示逻辑

---

## 10. 项目技术栈与目录结构

### 技术栈

| 层级 | 技术选型 |
|------|---------|
| 前端框架 | React + TypeScript |
| 图渲染 | React Flow |
| 自动布局 | dagre / ELK |
| UI 组件 | Ant Design |
| 前端构建 | Vite |
| 后端框架 | Python 3.10+ / FastAPI / uvicorn |
| 实时通信 | WebSocket |
| MLIR 核心 | mlir-python-bindings |
| 包管理 | pip / poetry |

### 目录结构

```
mlir-modifier/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Graph/              # React Flow 图渲染、节点/边组件
│   │   │   ├── PropertyPanel/      # 右侧属性编辑面板
│   │   │   ├── OpCreator/          # dialect/op 选择与创建表单
│   │   │   └── Toolbar/            # 顶部工具栏、面包屑导航
│   │   ├── services/               # API 调用、WebSocket 管理
│   │   ├── store/                  # 状态管理（undo/redo 前端状态）
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI 入口
│   │   ├── routers/                # API 路由（model、op、dialect）
│   │   ├── services/
│   │   │   ├── ir_manager.py       # MLIR Module 管理、ID 映射
│   │   │   ├── op_service.py       # Op CRUD 操作
│   │   │   ├── dialect_loader.py   # dialect 动态加载
│   │   │   └── history.py          # undo/redo Command 栈
│   │   └── models/                 # Pydantic 数据模型
│   ├── pyproject.toml
│   └── config.yaml
├── docs/
│   └── plans/
└── README.md
```
