# 前端 Agent 记忆

## 技术要点
- 所有组件使用 React 19 函数式组件 + TypeScript
- 状态管理：全局状态在 `App.tsx`，通过 props 传递，无 Redux/Zustand
- 图形渲染：XYFlow（React Flow）v12，节点类型注册在 `GraphView.tsx`
- 布局：**ELK layered**（替换了 Dagre），在 `layoutGraph.ts` 中封装，API 为 async
- UI 组件：Ant Design 6，不混用其他 UI 库
- HTTP：Axios，客户端封装在 `frontend/src/services/api.ts`

## 已知模式
- `irToFlow.ts` 负责将后端 IRGraph 数据结构转为 XYFlow 的 nodes/edges 格式
- 操作节点用 `OpNode.tsx`，Block 参数节点用 `InputNode.tsx`
- `viewPath` 是导航状态，格式为操作 ID 数组，表示当前嵌套层级路径
- 验证状态通过 `useValidation.ts` hook 订阅 WebSocket

## 开发原则
- **测试覆盖**: 添加新功能后必须添加对应的测试用例
  - 后端操作：需要添加 pytest 测试，覆盖正常场景、异常场景和边界情况
  - 前端功能：需要添加 vitest 测试，覆盖组件交互逻辑和 API 调用
- **禁止修改已有测试**: 严禁修改之前的测试用例。如果某些测试由于功能变更而失效，必须：
  1. 先与用户确认是否需要更新测试
  2. 获得确认后才能修改
  3. 修改时必须确保测试逻辑与新的功能需求完全一致

## 开发注意
- 修改类型定义请同步更新 `frontend/src/types/ir.ts`
- 新增 API 调用在 `frontend/src/services/api.ts` 中添加封装函数
- 前端测试：`make test-frontend`（vitest）

## 历史经验

### Op 类型过滤功能（2026-02-28）
- **功能**：用户可在 Toolbar Filter 按钮的 Popover 中勾选/取消某类 op，隐藏后节点和相关边均不显示
- **数据流**：`App.tsx`（`hiddenOpNames: Set<string>` + `availableOpNames` memo）→ `Toolbar.tsx`（Filter UI）→ `GraphView.tsx` → `irToFlow.ts`（`walkRegions` 跳过）
- **关键**：`availableOpNames` 用 `useMemo` 从 `graph.operations` 派生，切换文件自动更新；Badge 显示隐藏数量
- **注意**：`Set` 是引用类型，更新时必须 `new Set(prev)` 创建新实例，否则 React 检测不到变更

### ELK 布局替换 Dagre（2026-02-28）
- **原因**：Dagre 不支持端口排序约束，`reorderSourcesByOperandIndex` 后处理有局限；连线穿过中间节点无法避免
- **方案**：`layoutGraph.ts` 完全重写为 ELK `layered` 算法（async），配置：`FIXED_ORDER` 端口约束 + `LAYER_SWEEP` 交叉最小化 + `SPLINES` 边路由
- **端口定义**：`buildElkPorts()` 为 InputNode 生成 `out-0`（南侧），为 OpNode 生成 `in-N`（北侧）+ `out-N`（南侧），index 控制左右顺序
- **关键陷阱**：ELK JSON 要求端口 ID 在整个图中全局唯一。必须用复合 ID `${node.id}:out-0` 定义端口，边的 sources/targets 也用同样格式 `${edge.source}:out-0`。若只用本地 ID `out-0`，ELK 会抛出 `JsonImportException: Referenced shape does not exist`
- **async 处理**：`GraphView.tsx` 将 `useMemo` 改为 `useState` + `useEffect`（带 cancelled 标志防竞争），ELK layout 完成后 setState
- **fitView 自动触发**：内层 `LayoutSyncer` 组件（渲染在 `<ReactFlow>` 内部）用 `useReactFlow().fitView` 在每次布局更新后调用，实现隐藏/显示节点后视口自动适配
- **注意**：`useReactFlow()` 必须在 ReactFlowProvider 内调用，`LayoutSyncer` 放在 `<ReactFlow>` 子树中即可满足
