# 计划：添加 Operand 专用 "+" 号连接点

status: done
date: 2026-02-28
priority: high

## 需求描述

解决**无法直观地为 Op 添加新 operand**的问题，通过在每个 Op 节点顶部显示一个"+"号连接点，用户可以直接拖拽连线到这个位置来新增 operand。

### 用户故事
- 作为编辑器用户，我想要为某个 Op 额外添加一个输入
- 我在图中将另一个 Op 的输出结果拖拽到目标 Op 的"+"号连接点
- 系统自动为目标 Op 新增一个 operand，并连接到拖拽的值
- 如果新增 operand 后 IR 不合法，通过 ValidationBanner 显示错误信息

### 问题分析
当前实现中，Op 的输入 handle 数量 = 当前 operands 数量。用户无法直观地"添加新 operand"，只能猜测在某个位置拖拽才能触发新增逻辑。

### 解决方案
为每个 Op 额外渲染一个**"+"号连接点**（带 "+" 图标的特殊 handle），用户明确知道这是"添加新 operand"的入口。

## 影响范围

### 前端
- 修改 `frontend/src/components/Graph/OpNode.tsx` - 渲染额外的 "+" 号 handle
- 修改 `frontend/src/components/Graph/GraphView.tsx` - 识别并处理 "+" 号 handle 的连接
- 新增 `frontend/src/components/Graph/OpNode.test.tsx` - 测试 OpNode 渲染逻辑

### 后端
- 无需修改（已有 `POST /api/op/{op_id}/operand` 端点）

### 数据模型
- 无需修改

## 后端任务
无（现有 API 已完整支持）

## 前端任务

### 1. 修改 OpNode.tsx 添加 "+" 号连接点
**文件**: `frontend/src/components/Graph/OpNode.tsx`

- 在现有的 input handles 旁边渲染一个额外的 "add operand" handle
- Handle ID 格式：`in-add`（固定，不需要序号）
- 样式设计：
  - 圆形，带 "+" 号
  - 半透明（opacity: 0.6）
  - 虚线边框
  - 悬停时显示 tooltip："Add new operand"
- 布局位置：在最后一个现有 operand handle 的右侧

```tsx
// 在 Input handles 部分添加
{/* Input handles */}
{data.operands.map((_, i) => (
  <Handle
    key={`in-${i}`}
    type="target"
    position={Position.Top}
    id={`in-${i}`}
    /* ...existing styles... */
  />
))}

{/* Add new operand handle */}
<Handle
  type="target"
  position={Position.Top}
  id="in-add"
  style={{
    left: `${((data.operands.length + 1) / (data.operands.length + 2)) * 100}%`,
    background: color.header,
    opacity: 0.6,
    width: 12,
    height: 12,
    border: '2px dashed #999',
    cursor: 'crosshair',
    zIndex: 10,
  }}
  title="Add new operand"
/>
```

### 2. 修改 GraphView.tsx 处理 "+" 号连接点
**文件**: `frontend/src/components/Graph/GraphView.tsx`

- 更新 `handleConnect` 函数，识别 `in-add` handle
- 当连接到 `in-add` 时，调用 `onConnectProp(target, valueId, null)` (null 表示新增)

```typescript
// 在 handleConnect 中添加逻辑
const handleConnect = useCallback(
  (connection: Connection) => {
    if (!graph || !onConnectProp) return;
    const { source, sourceHandle, target, targetHandle } = connection;
    if (!source || !target) return;

    const valueId = resolveSourceValueId(graph, source, sourceHandle);
    if (!valueId) return;

    // 检查是否连接到 "add" handle
    if (targetHandle === 'in-add') {
      // 新增 operand
      onConnectProp(target, valueId, null);
      return;
    }

    const operandIndex = parseHandleIndex(targetHandle);
    const targetOp = graph.operations.find((o) => o.op_id === target);
    if (!targetOp) return;

    if (operandIndex < targetOp.operands.length) {
      // 替换现有 operand
      onConnectProp(target, valueId, operandIndex);
    } else {
      // 边界情况：连接到超出范围的 handle，也按新增处理
      onConnectProp(target, valueId, null);
    }
  },
  [graph, onConnectProp],
);
```

### 3. 添加前端测试
**文件**: `frontend/src/components/Graph/__tests__/OpNode.test.tsx`（新建）

- 测试 OpNode 渲染正确数量的 input handles
- 测试 "+" 号 handle 固存在
- 测试 "+" 号 handle 样式正确

```typescript
describe('OpNode', () => {
  it('renders input handles for operands', () => {
    const mockData: OpNodeData = {
      label: 'arith.addf',
      dialect: 'arith',
      attributes: {},
      operands: [{ value_id: 'v1', type: 'f32' }],
      results: [{ value_id: 'v2', type: 'f32' }],
      hasRegions: false,
    };
    // ... 测试逻辑
  });

  it('renders add operand handle', () => {
    // ... 测试 "+" 号 handle 存在
  });
});
```

## 接口约定

### 前端内部约定

#### 新增 Handle ID 格式
- 现有 operand handles: `in-0`, `in-1`, `in-2`, ...
- 新增 operand handle: `in-add`（固定 ID）

#### 连接逻辑
```typescript
// 当 targetHandle === 'in-add' 时
onConnectProp(target, valueId, null); // null 表示新增 operand

// 当 targetHandle 开始于 'in-' 但不是 'in-add' 时
const operandIndex = parseInt(targetHandle.split('-')[1], 10);
onConnectProp(target, valueId, operandIndex); // 替换现有 operand
```

### 已有后端 API（无需修改）

```
POST /api/op/{op_id}/operand
Content-Type: application/json

Request:
{
  "value_id": "v_123",
  "position": null  // null = 追加到末尾
}

Response (200 OK):
{
  "graph": IRGraph,
  "valid": boolean,
  "diagnostics": string[]
}
```

## UI 设计规范

### "+" 号连接点样式
- **形状**: 圆形，直径 12px
- **颜色**: 与 Op 头部颜色相同（dialect 颜色）
- **透明度**: 0.6（表示可选）
- **边框**: 2px dashed #999（虚线表示"添加"）
- **光标**: crosshair（表示可拖拽连接）
- **层级**: zIndex: 10（确保显示在最上层）
- **提示**: title="Add new operand"

### 位置布局
```
Op 顶部边框:
┌────────────────────────────────┐
│  [in-0]──[in-1]──[+ in-add]   │  ← handles 分布在顶部
│  操作头部     (arith.addf)     │
│  属性区域                      │
└────────────────────────────────┘
```

### 连线样式（现有机制保持）
- 边的样式由 `irToFlow.ts` 的 `generateEdges` 函数控制
- 不需要特别处理，因为 `in-add` 连接的是"新位置"（不在现有 edges 中）
- 操作成功后，边会在图重建时按正常规则渲染

## 开发原则遵循
- ✅ **最小改动**: 只修改前端组件，不触及后端核心逻辑
- ✅ **保持一致**: 样式与现有 OpNode 设计语言一致
- ✅ **测试覆盖**: 添加 OpNode 组件测试

## 验收标准

### 功能验收
- [ ] 所有 Op 节点显示一个"+"号连接点（位于现有 input handles 右侧）
- [ ] 用户可以将结果拖拽到"+"号连接点
- [ ] 拖拽完成后触发 operand 新增操作（调用 `POST /api/op/{op_id}/operand`）
- [ ] 操作后 ValidationBanner 显示验证结果（现有机制）

### 测试验收
- [ ] OpNode test.tsx 通过所有测试用例
- [ ] `make test-frontend` 全部通过
- [ ] 手动测试：创建新 operand 连接，验证功能正确

### 代码质量
- [ ] TypeScript 类型检查通过
- [ ] 前端 ESLint 无警告
