# Phase 3: IR 编辑功能

## Context

Phase 1 完成了项目脚手架、MLIR 加载、图渲染和测试体系。Phase 2 完成了嵌套 region 可视化、钻入导航和函数选择器。Phase 3 将实现 **IR 编辑功能**：属性修改、Op 删除、Op 创建、Undo/Redo 以及实时验证反馈，使工具从"只读查看器"进化为"可交互编辑器"。

---

## 分步计划

### 3a. 后端 Undo/Redo 基础设施（快照方式）

**思路**：采用文本快照（`str(module)` + `Module.parse()`），而非 Command 模式。原因：MLIR binding wrapper identity 不稳定，跨 mutation 持有引用不安全；文本 round-trip 对常规 IR 尺寸足够快；所有 mutation 类型自动获得 undo 支持。

**新建文件**：
- `backend/app/services/history.py` — `HistoryManager` 类
  - `_undo_stack: list[str]`、`_redo_stack: list[str]`
  - `snapshot(module_text: str)` — 压入 undo 栈，清空 redo 栈
  - `undo(current_text: str) -> str` — 当前状态压入 redo 栈，弹出 undo 栈返回
  - `redo(current_text: str) -> str` — 当前状态压入 undo 栈，弹出 redo 栈返回
  - `clear()` — 加载新文件时重置
  - `_max_history = 50` — 限制内存

**修改文件**：
- `backend/app/services/ir_manager.py`
  - 新增 `self.history = HistoryManager()`
  - 新增 `_snapshot()` — 在 mutation 前调用，保存当前 `str(self.module)`
  - `load()` 后调用 `self.history.clear()`
  - 新增 `undo() -> IRGraph` — 从 history 获取上一个文本，re-parse，rebuild_graph
  - 新增 `redo() -> IRGraph` — 同理
  - 新增 `validate() -> tuple[bool, list[str]]` — 调用 `self.module.operation.verify()`
- `backend/app/models/ir_schema.py`
  - 新增 `HistoryStatus(BaseModel)`: `can_undo: bool, can_redo: bool`
  - 新增 `EditResponse(BaseModel)`: `graph: IRGraph, valid: bool, diagnostics: list[str]`
- `backend/app/routers/edit.py` (新建)
  - `POST /api/undo` → 返回 `EditResponse`
  - `POST /api/redo` → 返回 `EditResponse`
  - `GET /api/history` → 返回 `HistoryStatus`
- `backend/app/main.py` — 注册 edit router

**测试**：`backend/tests/test_history.py` (~10 tests)
- snapshot/undo/redo 正常流程、空栈异常、redo 栈被新操作清空、上限截断、clear 重置

---

### 3b. 属性编辑（后端 + 前端）

**后端**：
- `backend/app/models/ir_schema.py`
  - 新增 `ModifyAttrRequest(BaseModel)`: `updates: dict[str, str]`（attr_name → MLIR 语法字符串）、`deletes: list[str]`
- `backend/app/services/ir_manager.py`
  - 新增 `modify_attributes(op_id, updates, deletes) -> IRGraph`
    1. 调用 `_snapshot()` 保存当前状态
    2. 通过 `self._op_map[op_id]` 获取 Operation
    3. 对 deletes 中的属性执行 `del op.attributes[name]`
    4. 对 updates 中的属性执行 `op.attributes[name] = ir.Attribute.parse(value_str, self.context)`
    5. 若 `Attribute.parse` 失败则 undo（re-parse snapshot）并抛异常
    6. `rebuild_graph()` 返回更新后的 graph
- `backend/app/routers/edit.py`
  - `PATCH /api/op/{op_id}/attributes` — 接收 `ModifyAttrRequest`，返回 `EditResponse`

**前端**：
- `frontend/src/services/api.ts`
  - 新增 `modifyAttributes(opId, updates, deletes)`, `undo()`, `redo()`, `getHistoryStatus()`
- `frontend/src/types/ir.ts`
  - 新增 `HistoryStatus`, `EditResponse` 接口
- `frontend/src/components/PropertyPanel/PropertyPanel.tsx`（重写属性区域）
  - 每个属性行变为：`[名称] [可编辑 Input] [删除按钮]`
  - 失焦或回车提交修改，调用 `onAttributeEdit` 回调
  - 错误时在行内显示红色提示
  - Props 新增 `onAttributeEdit(opId, updates, deletes) => Promise<void>`
- `frontend/src/App.tsx`
  - 新增 `handleAttributeEdit` — 调用 API、更新 graph、重新选中编辑后的 op
  - 传递回调给 PropertyPanel

**测试**：
- `backend/tests/test_edit_attributes.py` (~10 tests) — 修改/新增/删除属性、非法字符串 400、undo 恢复
- 前端 vitest：PropertyPanel 编辑行为的单元测试

---

### 3c. Op 删除（后端 + 前端）

**后端**：
- `backend/app/services/ir_manager.py`
  - 新增 `delete_op(op_id: str) -> IRGraph`
    1. `_snapshot()` 保存状态
    2. `op.detach_from_parent()` 从 block 中移除（**绝不调用 `op.erase()`**，因为 result 有 uses 时会 crash）
    3. `rebuild_graph()` 返回
    4. 删除后 module 可能无效（被删 op 的结果仍被引用），由 `validate()` 报告
- `backend/app/routers/edit.py`
  - `DELETE /api/op/{op_id}` — 返回 `EditResponse`（含 graph + valid + diagnostics）

**前端**：
- `frontend/src/services/api.ts` — 新增 `deleteOp(opId)`
- `frontend/src/components/Graph/GraphView.tsx`
  - 节点右键菜单添加"Delete"选项
  - 选中节点时 Delete/Backspace 键触发删除
  - Props 新增 `onDeleteOp(opId)`
- `frontend/src/App.tsx`
  - 新增 `validationStatus` 状态（`{valid, diagnostics}`）
  - 新增 `handleDeleteOp` — 调用 API、更新 graph/validation、清除 selectedOp
- `frontend/src/components/ValidationBanner.tsx`（新建）
  - 当 `!valid` 时显示红色/黄色横幅，展示诊断信息
  - 包含"Undo"快捷按钮

**测试**：
- `backend/tests/test_edit_delete.py` (~8 tests) — 删除叶子 op、删除有 uses 的 op（验证失败但不 crash）、undo 恢复、嵌套 op 删除

---

### 3d. WebSocket 实时验证

**后端**：
- `backend/app/services/notifier.py`（新建）
  - `ValidationNotifier` — 管理 WebSocket 连接列表、`broadcast(valid, diagnostics)`
- `backend/app/routers/ws.py`（新建）
  - `@app.websocket("/ws/validation")` — accept 连接，维护生命周期
- `backend/app/main.py` — 挂载 WebSocket 端点
- `backend/app/routers/edit.py` — 每次 mutation 后调用 `notifier.broadcast()`

**前端**：
- `frontend/src/hooks/useValidation.ts`（新建）
  - 管理 `ws://localhost:8000/ws/validation` 连接
  - 返回 `{valid, diagnostics, connected}`，自动重连
- `frontend/src/App.tsx` — 使用 `useValidation()` hook，传给 ValidationBanner

**测试**：`backend/tests/test_ws.py` (~5 tests) — 连接、断开、mutation 后广播

---

### 3e. Undo/Redo 前端 UI + 快捷键

**前端**：
- `frontend/src/hooks/useKeyboardShortcuts.ts`（新建）
  - `Ctrl+Z` / `Cmd+Z` → undo
  - `Ctrl+Shift+Z` / `Cmd+Shift+Z` → redo
  - `Delete` / `Backspace`（选中节点时）→ delete
- `frontend/src/components/Toolbar/Toolbar.tsx`
  - 新增 Undo/Redo 按钮（antd `UndoOutlined`/`RedoOutlined` 图标）
  - Props 新增 `onUndo`, `onRedo`, `canUndo`, `canRedo`
- `frontend/src/App.tsx`
  - 新增 `historyStatus` 状态，每次 mutation 后刷新
  - 新增 `handleUndo`, `handleRedo` 回调
  - 挂载 `useKeyboardShortcuts`

---

### 3f. Op 创建（后端 + 前端）

**难点**：MLIR Python binding 没有"列出某个 dialect 下所有已注册 op"的 API。`ctx.is_registered_operation(name)` 只能检查单个 op 是否已注册。

**解决方案**：通过反射 MLIR Python dialect 模块获取 op 列表。每个内置 dialect 的 Python 模块（如 `mlir.dialects.arith`）包含 OpView 子类（如 `AddFOp`），可通过 `inspect` 提取。对于无 Python 绑定的 dialect，允许用户手动输入 op 全名。

**后端**：
- `backend/app/services/dialect_registry.py`（新建）
  - `list_dialects() -> list[str]` — 返回已知 dialect 列表（内置 + 动态加载的）
  - `list_ops(dialect_name: str) -> list[OpDefinition]` — 通过 `importlib` 加载 `mlir.dialects.{name}`，用 `inspect` 找到所有 OpView 子类，提取 OPERATION_NAME、属性定义
  - `OpDefinition` — 包含 op_name、attributes 模板信息
  - 兜底：对于没有 Python binding 的 dialect，返回空列表，允许用户手动输入 op 名
- `backend/app/models/ir_schema.py`
  - 新增 `OpDefinition(BaseModel)`: `name: str, dialect: str, description: str`
  - 新增 `CreateOpRequest(BaseModel)`: `op_name: str, result_types: list[str], operands: list[str]`（operand value_ids）, `attributes: dict[str, str]`, `insert_point: InsertPointInfo`
  - 新增 `InsertPointInfo(BaseModel)`: `block_id: str, position: int | None`（None = append）
- `backend/app/services/ir_manager.py`
  - 新增 `create_op(request: CreateOpRequest) -> IRGraph`
    1. `_snapshot()` 保存状态
    2. 解析 result_types 为 `ir.Type` 列表：`ir.Type.parse(type_str, self.context)`
    3. 查找 operand value_ids 对应的 `ir.Value` 对象：`self._value_map[vid]`
    4. 解析 attributes：`{name: ir.Attribute.parse(val, self.context)}`
    5. 获取 target block：`self._block_map[block_id]`
    6. 确定 InsertionPoint：按 position 定位
    7. 调用 `ir.Operation.create(op_name, results=types, operands=vals, attributes=attrs, ip=insertion_point)`
    8. `rebuild_graph()` 返回
- `backend/app/routers/edit.py`
  - `GET /api/dialects` — 返回 dialect 列表
  - `GET /api/dialect/{name}/ops` — 返回该 dialect 的 op 列表
  - `POST /api/op/create` — 接收 `CreateOpRequest`，返回 `EditResponse`

**前端**：
- `frontend/src/services/api.ts`
  - 新增 `listDialects()`, `listDialectOps(name)`, `createOp(request)`
- `frontend/src/types/ir.ts`
  - 新增 `OpDefinition`, `CreateOpRequest`, `InsertPointInfo` 接口
- `frontend/src/components/OpCreator/OpCreator.tsx`（新建）
  - 对话框/抽屉组件，分步引导：
    1. 选择 dialect（下拉框，数据来自 `GET /api/dialects`）
    2. 选择 Op 或手动输入 op 全名（列表来自 `GET /api/dialect/{name}/ops`，支持搜索过滤）
    3. 填写参数表单：result types（文本输入 MLIR 类型字符串如 `f32`、`tensor<2x3xf32>`）、选择 operands（从当前可见 values 中选择）、填写 attributes
    4. 选择插入位置（哪个 block、在第几个位置）
    5. 确认创建
  - Props: `visible`, `onClose`, `onCreateOp(request)`, `graph`（用于提供可选 operand 列表）
- `frontend/src/components/Graph/GraphView.tsx`
  - 右键画布空白区域 → 菜单中添加"Add Op"选项
- `frontend/src/components/Toolbar/Toolbar.tsx`
  - 新增"Add Op"按钮
- `frontend/src/App.tsx`
  - 新增 `showOpCreator` 状态控制对话框显隐
  - 新增 `handleCreateOp` 回调

**测试**：
- `backend/tests/test_dialect_registry.py` (~6 tests) — 列出 dialect、列出 arith 的 ops、无 binding 的 dialect 返回空
- `backend/tests/test_edit_create.py` (~8 tests) — 创建简单 op、创建带 operand 的 op、创建带 attributes 的 op、非法 type 返回 400、undo 恢复
- 前端 vitest：OpCreator 组件的基本渲染和交互测试

---

## 实现顺序

```
3a (Undo/Redo 基础) → 3b (属性编辑) → 3c (Op 删除) → 3f (Op 创建) → 3d (WebSocket) → 3e (Undo/Redo UI)
```

3a 必须先行（所有 mutation 依赖它）。3b 最简单，先做积累经验。3c 和 3f 是核心编辑功能。3d 和 3e 是体验增强，放在最后。

## 关键风险与对策

| 风险 | 对策 |
|------|------|
| `op.erase()` 在 result 有 uses 时 crash 进程 | 只用 `detach_from_parent()`，永不调用 `erase()` |
| Wrapper identity 不稳定，跨 mutation 引用失效 | 每次 mutation 后 `rebuild_graph()` 重建所有 map |
| `Attribute.parse()` 输入非法时异常 | 先 snapshot 再 mutation，失败时 undo 回原始状态，返回 400 |
| 无法枚举 dialect 中所有已注册 op | 反射 Python dialect 模块提取 OpView 子类；无 binding 时允许手动输入 |
| 创建 op 时 operand 类型不匹配 | 创建后调用 `validate()` 检测类型错误，前端展示诊断信息 |
| 单例 IRManager 不支持并发 | Phase 3 为单用户工具，文档标注限制即可 |

## 验证方式

1. **后端测试**：`cd backend && PYTHONPATH=/home/yuding/work/llvm-project/build/tools/mlir/python_packages/mlir_core:. .venv/bin/python3 -m pytest tests/ -v`
2. **前端测试**：`cd frontend && npx vitest run`
3. **端到端手动测试**：
   - 加载 `.mlir` 文件 → 选中 op → 在属性面板编辑属性值 → 确认图更新
   - 选中 op → Delete 键删除 → 确认图更新、验证横幅显示
   - 点击 "Add Op" → 选择 dialect → 选择 op → 填写参数 → 创建 → 确认新节点出现在图中
   - Ctrl+Z 撤销 → 确认恢复到操作前状态
   - Ctrl+Shift+Z 重做 → 确认重新执行
