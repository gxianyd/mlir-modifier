# 计划文档索引

此目录存放架构师 agent 生成的开发计划。

## 文件命名规范
- `plan-YYYY-MM-DD-<feature-name>.md` — 具体功能计划
- `plan-<feature-name>-v<N>.md` — 迭代版本

## 状态标记
在计划文件头部使用以下状态：
- `status: draft` — 草稿，待用户确认
- `status: approved` — 已确认，等待开发
- `status: in-progress` — 开发中
- `status: done` — 已完成

## 计划列表

| 文件 | 功能 | 状态 | 日期 |
|------|------|------|------|
| [plan-2026-02-28-operand-order-layout.md](plan-2026-02-28-operand-order-layout.md) | 操作数顺序感知布局（消除输入连线交叉） | done | 2026-02-28 |
| [plan-2026-02-28-op-filter.md](plan-2026-02-filter.md) | Op 类型过滤（图简化显示） | done | 2026-02-28 |
| [plan-2026-02-28-elk-layout.md](plan-2026-02-28-elk-layout.md) | ELK 布局替换 Dagre + fitView 自动适配 | done | 2026-02-28 |
| [plan-2026-02-28-delete-node-options.md](plan-2026-02-28-delete-node-options.md) | 删除节点两种模式（单节点/级联） | done | 2026-02-28 |
| [plan-2026-02-28-operand-add-handle.md](plan-2026-02-28-operand-add-handle.md) | 添加 Operand 专用 "+" 号连接点 | approved | 2026-02-28 |
