# 计划：Op 类型过滤（图简化显示）
status: done
date: 2026-02-28
priority: high

## 需求描述
用户可以选择隐藏某些 op 类型（按精确 op 名，如 `arith.constant`、`hbir.constant`），
使图中不显示这类节点及其连线，降低图的视觉复杂度、提升阅读效率。

## 影响范围
- **后端**：无需改动
- **数据模型**：无需改动
- **前端**：修改 3 个文件，数据流为 App.tsx → GraphView.tsx → irToFlow.ts

## 设计方案

### 数据流
```
App.tsx
  hiddenOpNames: Set<string>       ← 用户勾选的待隐藏 op 名集合
  availableOpNames: string[]       ← 从 graph.operations 中提取的全部 op 类型（去重排序）
       ↓ props
Toolbar.tsx
  Filter 按钮 + Popover 勾选列表  ← 用户操作入口
       ↓ props
GraphView.tsx
  hiddenOpNames 传给 irToFlow()
       ↓ 参数
irToFlow.ts  walkRegions()
  if (hiddenOpNames?.has(op.name)) continue;   ← 核心过滤逻辑
```

### 关键设计决策
1. `hiddenOpNames` 是 `Set<string>`，存在 `App.tsx`（全局状态）
2. `availableOpNames` 用 `useMemo` 从 `graph.operations` 实时派生（加载新文件自动更新）
3. 加载新文件时**不重置** hiddenOpNames，方便用户在多函数间保持同样的过滤设置
4. 被过滤的 op 的出入边自动消失（irToFlow 只为 visibleOpIds 生成边，天然支持）
5. 过滤不影响 PropertyPanel 等其他面板（仅影响图渲染）

## 前端任务

### 任务 1：irToFlow.ts — 增加 hiddenOpNames 参数
- [x] `irToFlow()` 函数新增第 4 个可选参数：`hiddenOpNames?: Set<string>`
- [x]将 `hiddenOpNames` 透传到 `walkRegions()`
- [x]在 `walkRegions` 中，处理每个 op 前先判断：
  ```typescript
  if (hiddenOpNames?.has(op.name)) continue;
  ```
  （三个 if/else if/else 分支前统一加，或提前 `continue` 跳过）

### 任务 2：GraphView.tsx — 接收并传递 hiddenOpNames
- [x]在 `GraphViewProps` 中新增：`hiddenOpNames?: Set<string>`
- [x]将 `hiddenOpNames` 传入 `irToFlow(graph, viewPath, DEFAULT_MAX_EXPAND_DEPTH, hiddenOpNames)`

### 任务 3：Toolbar.tsx — 增加 Filter 按钮和 Popover
- [x]新增 props：
  ```typescript
  availableOpNames?: string[]          // 当前图中所有 op 类型
  hiddenOpNames?: Set<string>          // 当前已隐藏的 op 名集合
  onHiddenChange?: (hidden: Set<string>) => void
  ```
- [x]在 "Add Op" 按钮旁边加 `Filter` 按钮（使用 `FilterOutlined` 图标）
  - 仅在 `hasModel` 时显示
  - 若有隐藏项，按钮显示 badge 数字（如 "Filter (2)"）
- [x]按钮点击弹出 Ant Design `Popover`，内容为：
  - 标题："Op 类型过滤"
  - op 名勾选列表（`Checkbox` 逐项）：勾选 = 显示（即勾选的不在 hiddenOpNames 中）
  - 底部操作栏：[全选] [全不选]
  - 默认所有 op 全部显示（无隐藏）

### 任务 4：App.tsx — 添加状态和派生数据
- [x]新增状态：`const [hiddenOpNames, setHiddenOpNames] = useState<Set<string>>(new Set())`
- [x]新增 memo：
  ```typescript
  const availableOpNames = useMemo(() => {
    if (!graph) return [];
    return [...new Set(graph.operations.map((o) => o.name))].sort();
  }, [graph]);
  ```
- [x]向 `Toolbar` 传入：`availableOpNames`、`hiddenOpNames`、`onHiddenChange={setHiddenOpNames}`
- [x]向 `GraphView` 传入：`hiddenOpNames`

## 接口约定
无新增 API 端点，纯前端状态。

## 验收标准
- [x]加载 MLIR 后，Toolbar 中出现 Filter 按钮
- [x]Filter Popover 中列出当前图所有 op 类型（无重复）
- [x]取消勾选某 op 类型后，图中该类型的节点和关联边立即消失，布局重新计算
- [x]重新勾选后节点重新出现
- [x]"全不选" 后图只剩非过滤节点（极端情况：图可能为空）
- [x]切换函数视图或下钻时，过滤设置保持
- [x]`make test-frontend` 通过（16 个测试全绿）
