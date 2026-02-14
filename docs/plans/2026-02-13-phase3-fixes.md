# Phase 3 Fixes — Op Definition Introspection, Safe Deletion, Type Picker

## Problem 1: Op Creation 需要自动解析 Op 定义

**现状**: OpCreator 让用户自由添加 operand、result、attribute，完全手动。
**目标**: 选择 Op 后，自动从 `__init__` 签名解析出 operand 数量/名称、result 数量、attribute 名称，用户只需填值。

### 方案

**后端 — 增强 `dialect_registry.py`**:
- 新增 `get_op_signature(op_name: str) -> OpSignature` 函数
- 通过 `inspect.signature(OpViewClass.__init__)` 解析参数:
  - 位置参数 (不含 self): 区分 operand 和 attribute
    - 有些位置参数是属性（如 `CmpFOp(predicate, lhs, rhs)` 中 `predicate` 是属性）
    - 约定: 参数名为 `result`/`results` → 忽略(由类型推断); 其余根据 OpView 的 property 类型区分
    - 实际上更简单：对比 OpView 上的 property —— 如果同名 property 返回的是 Value/OpResult 类型，则为 operand；否则为 attribute
  - 关键字参数 (除 `loc`, `ip`, `results`): 可选 attribute
  - `_ODS_REGIONS`: 提取 region 信息
- 返回 `OpSignature`:
  ```python
  @dataclass
  class OpParamInfo:
      name: str
      kind: str  # "operand" | "attribute"
      required: bool

  @dataclass
  class OpSignature:
      op_name: str
      params: list[OpParamInfo]  # 有序参数列表
      num_results: int  # -1 表示可变
      num_regions: int
  ```
- 通过 `__init__` 中 `results` 参数的默认值和位置判断 result 数量:
  - 有 `result` 位置参数 (如 ConstantOp) → 1 result
  - 有 `results` 关键字参数 → 可变 result (用 -1 表示)
  - 无 result/results → 0 result (如 ReturnOp)

**实际的参数分类策略 (简化可靠)**:
分析 `__init__` 签名中的位置参数：
1. 跳过 `self`
2. 如果参数名是 `result` → 代表 1 个 result type 参数, 不算 operand
3. 其余位置参数: 在 OpView 类上检查是否有同名 property，如果有，尝试判断是 operand 还是 attribute:
   - 常见 operand 名: lhs, rhs, condition, true_value, false_value, operand, source, ...
   - 常见 attribute 名: predicate, value, fastmath, ...
   - **更可靠**: 尝试在 Python 源码中查找 property 的 getter，看是否调用 `get_operand`/`get_results` 等方法 → 太复杂
   - **最简单可靠方案**: 区分规则为——如果参数名也出现在 `_ODS_OPERAND_SEGMENTS` 中，则为 operand；但 `_ODS_OPERAND_SEGMENTS` 通常是 None...
   - **实用方案**: 仍然通过 `__init__` 解析参数，但在前端分为两组显示：required 参数和 optional 参数。required 参数中，有些是 operand（需要选择 value_id），有些是 attribute（需要输入 MLIR 字面量）。在每个参数旁添加一个 type 切换选项让用户确认类型。

**最终简化方案**:
- 位置参数中，`result` 名称 → 表示 result type（不是 operand）
- 位置参数的其余参数 → 统一标记为 required param，由前端提供 operand/attribute 切换
- 但更好的做法是：遍历所有已注册的 op property，检查哪些 property 名出现在位置参数中，根据 property descriptor 的实际类来区分:
  - 生成的 Python binding 中，operand accessor 返回 `OpOperand` 相关类型
  - 但这在 Python 侧不易检查

**最终采用的方案 — 基于启发式**:
1. 解析 `__init__` 签名获取所有参数
2. 忽略 `self`, `loc`, `ip`
3. `result`/`results` → result 相关（跳过或标记）
4. 其余位置参数 → 标为 required
5. 其余关键字参数 → 标为 optional attribute
6. **区分 operand vs attribute**: 利用 OpView 类上是否存在同名 property 且不在 BASE_PROPERTIES 集合中
   - 如果参数在基类 OpView 的 property 中 → 跳过
   - 如果参数是 op-specific property → 进一步启发判断
   - 实际实现中，我们提供两组: `operands` (参数名列表) + `attributes` (参数名列表)
   - **启发式**: 参数如果出现在 `__init__` 的位置参数中且不是 `result`，如果同名 property 存在于类上但不在基类上，就检查该 property 是否也在关键字参数中有同名条目——如果在关键字参数中则为 attribute

最终实际判定方式（从实际探查结果）:
- `AddFOp(self, lhs, rhs, *, fastmath=None, results=None, ...)` → lhs, rhs 是 operand; fastmath 是 attribute
- `ConstantOp(self, result, value, *, ...)` → result 是 result type; value 是 attribute
- `CmpFOp(self, predicate, lhs, rhs, *, fastmath=None, results=None, ...)` → predicate 是 attribute; lhs, rhs 是 operand
- `SelectOp(self, condition, true_value, false_value, *, results=None, ...)` → condition, true_value, false_value 是 operand

**观察**: 关键字参数（除 loc/ip/results）总是 attribute。位置参数中 `result` 是 result type。问题是位置参数中如何区分 operand 和 attribute（如 CmpFOp 的 predicate 是属性但在位置参数中）。

**最终方案**: 简化处理，对位置参数采用以下启发:
- 在 OpView 类上找同名 property，尝试创建一个空实例然后检查类型 → 不可行
- **直接查看生成的 `_ods_gen.py` 源码**: 生成的 OpView 中，operand 的 accessor 使用 `_get_operand_value` 或 `operand`，attribute 的 accessor 使用 `attributes[...]`
- **通过 `inspect.getsource(property.fget)`** 检查源码中是否包含 `operand` 关键词

实际可行方案:
```python
def _classify_param(cls, param_name):
    prop = getattr(cls, param_name, None)
    if prop is None or not isinstance(prop, property) or prop.fget is None:
        return "operand"  # default assumption
    try:
        src = inspect.getsource(prop.fget)
        if "operand" in src or "Operand" in src:
            return "operand"
        if "attributes" in src or "Attribute" in src:
            return "attribute"
    except (OSError, TypeError):
        pass
    return "operand"  # default
```

这样可以正确分类:
- `lhs` → property getter 包含 operand → operand ✓
- `predicate` → property getter 包含 attributes → attribute ✓
- `value` (ConstantOp) → property getter 包含 attributes → attribute ✓

**新增 API endpoint**: `GET /api/op/{op_name}/signature` → 返回 `OpSignature`

**新增 Pydantic model**: `OpParamInfo`, `OpSignatureResponse`

**前端 — 改造 OpCreator**:
- 选择 Op 后，调用 `/api/op/{op_name}/signature` 获取签名
- 根据签名自动渲染:
  - operand 参数: 显示 Select 选择现有 value
  - attribute 参数: 显示输入框
  - result types: 根据 `num_results` 显示对应数量的类型选择器
- 移除手动添加/删除 operand、result、attribute 的按钮

---

## Problem 2: 删除 Op 时自动处理 uses

**现状**: `delete_op` 直接 `detach_from_parent()`，如果 op 结果被其他 op 使用会导致 `<<UNKNOWN SSA VALUE>>`，进一步操作可能 crash。
**目标**: 自动替换所有 uses 后再 detach。

### 方案

修改 `ir_manager.py` 的 `delete_op`:
1. 遍历被删除 op 的所有 results
2. 对每个 result, 收集 `result.uses` 找到所有使用者
3. 策略: **级联删除** — 递归删除所有使用该 result 的 op
   - 但这可能删除太多，用户可能只想删一个
   - 替代策略: 不级联，而是用该 result 对应的同类型 block argument 或常量替代 → 太复杂
4. **采用方案**:
   - 先检查 op 的所有 result 是否有 uses
   - 如果有 uses，**级联删除所有使用者**（递归，直到没有 uses）
   - 删除顺序: 先删最深层（后序遍历），再删当前 op
   - 使用 snapshot + rollback 保障安全

```python
def delete_op(self, op_id: str) -> IRGraph:
    self._snapshot()
    op = self._op_map[op_id]

    # Collect all ops that need to be deleted (topological order: users first)
    to_delete = []
    self._collect_dependents(op, to_delete, visited=set())

    # Detach in reverse dependency order (users before producers)
    for dep_op in to_delete:
        dep_op.detach_from_parent()

    return self.rebuild_graph()

def _collect_dependents(self, op, result: list, visited: set):
    op_ptr = id(op)  # Use Python id for visited tracking
    if op_ptr in visited:
        return
    visited.add(op_ptr)

    for res in op.results:
        for use in res.uses:
            user_op = use.owner
            self._collect_dependents(user_op, result, visited)

    result.append(op)  # Add after all dependents (post-order)
```

---

## Problem 3: 类型选择器 UI

**现状**: 用户在 Input 中手动输入 MLIR 类型字符串（如 `f32`, `tensor<2x3xf32>`）。
**目标**: 提供可视化类型选择器。

### 方案

**前端 — 新增 TypePicker 组件** (`frontend/src/components/OpCreator/TypePicker.tsx`):

基础类型选项:
- 整数: `i1`, `i8`, `i16`, `i32`, `i64`
- 浮点: `f16`, `bf16`, `f32`, `f64`
- Index: `index`

复合类型:
- Tensor: 选择 element type + 输入 shape (如 `2x3x4`)
- Memref: 选择 element type + 输入 shape
- Vector: 选择 element type + 输入 shape

UI 交互:
1. 顶层 Select: 选择类型种类 (`scalar`, `tensor`, `memref`, `vector`)
2. 如果 scalar: 直接从基础类型中选择
3. 如果 tensor/memref/vector:
   - Select 选择 element type（基础类型列表）
   - Input 输入 shape（格式: `2x3x4`，自动拼接为 `tensor<2x3x4xf32>`）

组件接口:
```tsx
interface TypePickerProps {
  value: string;        // 当前类型字符串
  onChange: (type: string) => void;
}
```

**同样用于属性值编辑**: 当属性值是类型时（如 function_type），可以用 TypePicker。但属性值种类太多，暂不在 PropertyPanel 中使用 TypePicker，仅在 OpCreator 中使用。

---

## 实施顺序

1. **后端**: 增强 `dialect_registry.py` — 添加 `get_op_signature()`，基于 `inspect.signature` + property 源码分析
2. **后端**: 新增 API endpoint `GET /api/op/{op_name}/signature`
3. **后端**: 修复 `delete_op` — 级联删除 dependents
4. **前端**: 创建 `TypePicker` 组件
5. **前端**: 改造 `OpCreator` — 根据签名自动渲染参数表单，使用 TypePicker
6. **测试**: 后端 dialect_registry 新测试 + delete_op 级联测试 + 前端编译通过
