# 计划：操作数顺序感知的图布局（消除输入连线交叉）
status: done
date: 2026-02-28
priority: high

## 需求描述
当一个 op 有多个输入时，Dagre 布局算法不感知 XYFlow 节点的 handle 端口顺序，
导致上游源节点的水平排列顺序与操作数索引顺序不匹配，产生大量连线交叉，不直观。

期望行为：上游节点从左到右的水平排列顺序 = 它们连接的操作数索引（0 = 最左）。

## 根因
- `OpNode.tsx:66-67`：handle `in-0` 位于节点最左，`in-N` 位于最右（均匀分布）
- `irToFlow.ts:269`：边的 `targetHandle` 为 `in-${operandIdx}`，体现操作数顺序
- `layoutGraph.ts`：Dagre 做 barycenter 排序时不知道 handle 端口位置，
  仅按全局边交叉数优化，无法保证源节点 x 位置与操作数索引对齐

## 影响范围
- 后端：**无需改动**
- 数据模型：**无需改动**
- 前端：仅修改 `frontend/src/components/Graph/layoutGraph.ts`

## 方案设计

### 核心思路
在 Dagre 完成布局后，对 Dagre 图做后处理：
对每个 consumer op T，找出同一 rank（y 层）的源节点组，
将这些源节点的 x 坐标按其对应的操作数索引重新排序：
- 操作数 0 的源 → 组内最小 x（最左）
- 操作数 1 的源 → 第二小 x
- ...依此类推

这样保留 Dagre 决定的 x 分布范围，只调整同 rank 内的相对顺序。

### 跳过处理的节点
- 同时作为多个不同 consumer 的源节点（避免为一个 consumer 排序后破坏另一个）
- 同时作为同一 consumer 多个操作数的源节点（逻辑上无法决定位置）
- bucket 中只有一个节点（无需排序）

### 算法步骤（在 `dagre.layout(g)` 后执行）
1. 遍历 edges，构建 `targetId → [(sourceId, operandIdx)]` 映射
2. 统计每个 source 被多少个不同 target 引用（sourceTargetCount）
3. 统计每个 source 在同一 target 中出现次数（sourceOccurrencesPerTarget）
4. 对每个 target 的 sources：
   a. 按 y 坐标分组（quantize: `Math.round(nodePos.y)`），得到同 rank 的 bucket
   b. 跳过 sourceTargetCount > 1 或 occurrences > 1 的 source
   c. 将 bucket 内现有 x 坐标排序（升序）
   d. 将 bucket 按 operandIdx 升序排列
   e. 将排序后的 x 坐标依次分配给对应 source

## 前端任务
- [x] 在 `layoutGraph.ts` 中，在 `dagre.layout(g)` 调用之后、转换为左上角坐标之前，
      添加 `reorderSourcesByOperandIndex(g, edges)` 后处理函数
- [x] 运行 `make test-frontend` 验证不破坏现有测试
- [ ] 手动验证多输入 op（如 hbir.batchnorm）的连线不再交叉

## 接口约定
无（纯前端内部实现，无 API 变更）

## 验收标准
- [ ] 多输入 op 的上游节点从左到右的水平顺序 = 操作数索引顺序（0 最左）
- [ ] 单输入 op 不受影响
- [ ] 源节点被多个 consumer 引用时，不产生错误，仅跳过重排（保持 Dagre 原始位置）
- [x] `make test-frontend` 通过（16 个测试全绿）
