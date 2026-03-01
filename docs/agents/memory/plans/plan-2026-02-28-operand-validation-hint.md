# 计划：新增 Operand 时的简化快速校验提示

status: approved
date: 2026-02-28
priority: medium

## 需求描述

在添加连接关系时，允许 Op 新增 Operand。如果新增 Operand 后的 Op 可能不合法，在操作前显示**简化快速校验**的警告提示，但允许用户选择继续。

### 用户故事
- 作为用户，我在图中拖拽连接线，将一个操作的结果连接到另一个操作的输入端
- 如果目标操作已经没有合法的输入端点，系统会自动尝试新增 operand
- 在新增 operand 之前，系统进行简化的快速校验（检查类型兼容性、operand 数量约束等）
- 如果校验发现可能导致不合法的情况，显示警告对话框，让用户选择"继续"或"取消"
- 无论用户选择继续还是取消，操作后仍然通过 ValidationBanner 显示完整的 MLIR 验证结果（现有机制）

### 现状分析
- ✅ 前端已支持新增 operand（GraphView.tsx handleConnect，operandIndex=null 时）
- ✅ 后端已实现 `POST /api/op/{op_id}/operand` 端点
- ✅ 操作后通过 WebSocket 推送验证结果，ValidationBanner 显示错误
- ❌ 缺少操作前的简化快速校验和警告提示

## 影响范围

### 后端
- 新增端点：`POST /api/op/{op_id}/operand/validate` — 预校验 operand 新增是否可能合法
- 无需修改现有端点

### 前端
- 修改 `frontend/src/components/Graph/GraphView.tsx`：handleConnect 中调用预校验
- 新增 `frontend/src/services/api.ts`：validateOperandAdd API 函数
- 修改类型定义 `frontend/src/types/ir.ts`：添加 ValidateOperandAddResponse

### 数据模型
- 后端：新增 `ValidateOperandAddResponse` 模型
- 前端：同步类型定义

## 后端任务

- [ ] 新增 `ValidateOperandAddResponse` 数据模型（`backend/app/models/ir_schema.py`）
  ```python
  class ValidateOperandAddResponse(BaseModel):
      allowed: bool  # 简化快速校验是否通过
      warnings: list[str] = []  # 潜在问题列表（如类型不匹配）
      op_signature: OpSignatureResponse | None  # 目标 Op 的签名信息
  ```

- [ ] 实现 `validate_add_operand` 方法（`backend/app/services/ir_manager.py`）
  - 根据 op_name 获取 OpSignature（使用 existing get_op_signature）
  - 检查：operand 数量约束（固定数量 vs variadic）
  - 检查：类型兼容性（比较 sourceValue.type 与 op 期望的类型）
  - 返回：allowed=False 时提供 warnings

- [ ] 新增预校验端点（`backend/app/routers/edit.py`）
  ```python
  @router.post("/op/{op_id}/operand/validate", response_model=ValidateOperandAddResponse)
  async def validate_operand_add(op_id: str, request: AddOperandRequest):
      """Quick validation before adding a new operand."""
      ...
  ```

- [ ] 添加测试用例（`backend/tests/test_edit_delete.py`）
  - 测试：合法的 operand 新增（variadic op + 兼容类型）
  - 测试：非法的 operand 新增（固定数量 op + 超出）
  - 测试：类型不兼容的情况

## 前端任务

- [ ] 添加 `ValidateOperandAddResponse` 类型（`frontend/src/types/ir.ts`）
  ```typescript
  export interface ValidateOperandAddResponse {
    allowed: boolean;
    warnings: string[];
    op_signature: OpSignature | null;
  }
  ```

- [ ] 添加 `validateOperandAdd` API 函数（`frontend/src/services/api.ts`）
  ```typescript
  export async function validateOperandAdd(
    opId: string,
    valueId: string,
    position?: number,
  ): Promise<ValidateOperandAddResponse>;
  ```

- [ ] 修改 `handleConnect` 增加预校验逻辑（`frontend/src/components/Graph/GraphView.tsx`）
  - 在调用 `onConnectProp` 之前，先调用 `validateOperandAdd`
  - 如果有 warnings，显示 `Modal.confirm` 让用户选择
  - 用户确认后才继续原有流程
  - 用户取消则阻止操作

- [ ] 更新 `GraphViewProps` 类型（可选）
  - 添加 `onValidateOperandAdd?: (...) => Promise<ValidateOperandAddResponse>`
  - 或直接在组件内部调用 API（更简单）

## 接口约定

### 后端新增端点

```
POST /api/op/{op_id}/operand/validate
Content-Type: application/json

Request:
{
  "value_id": "v_123",          // 要添加的 value 的 ID
  "position": null              // null = 追加到末尾，或指定索引
}

Response (200 OK):
{
  "allowed": true,              // false = 快速校验未通过
  "warnings": ["Type mismatch: expected i32, got i64"],
  "op_signature": {
    "op_name": "arith.addi",
    "params": [
      {"name": "lhs", "kind": "operand", "required": true},
      {"name": "rhs", "kind": "operand", "required": true}
    ],
    "num_results": 1,
    "num_regions": 0
  }
}
```

### 前端 API 函数

```typescript
export async function validateOperandAdd(
  opId: string,
  valueId: string,
  position?: number,
): Promise<ValidateOperandAddResponse> {
  const response = await api.post<ValidateOperandAddResponse>(
    `/op/${opId}/operand/validate`,
    { value_id: valueId, position: position ?? null }
  );
  return response.data;
}
```

## 简化快速校验规则

### 校验逻辑（简化版，不要求 100% 准确）

1. **操作数数量约束**
   - 如果 OpSignature 中所有 operand 参数都是 `required: true` 且数量固定
   - 当前 operands 数量 + 1 > required 参数数量 → warning

2. **Variadic 检查**
   - 如果 NumOperandGroups（从 MLIR 深入获取，或近似判断）支持 variadic → 通过
   - 否则检查是否超出固定数量

3. **类型兼容性（可选，如果签名中有类型信息）**
   - 比较 sourceValue.type 与 op 期望的类型
   - 如果类型完全不兼容（如 tensor vs scalar）→ warning
   - 允许数值类型间的隐式转换（如 f32 -> f64）→ 警告但不阻止

### 注意事项

- 快速校验的目的是**提示**，不是严格的验证
- 即使 `allowed: false`，用户仍可以继续操作
- 完整的 MLIR 验证通过现有的 WebSocket + ValidationBanner 机制提供

## 验收标准

- [ ] 用户连接到新 operand 时，系统显示警告对话框（如果有可能不合法）
- [ ] 用户可以选择"继续"或"取消"操作
- [ ] "继续"后，原有的 ValidationBanner 仍显示完整的 MLIR 验证结果
- [ ] 后端测试覆盖：合法、非法、类型不兼容等场景
- [ ] 功能不影响现有的删除 operand、重现接等操作
