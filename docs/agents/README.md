# MLIR Modifier — Agent 协作开发指南

本文档详细说明如何使用 Claude Code 的多 Agent 体系进行 MLIR Modifier 项目的开发。

## 目录

- [概述](#概述)
- [Agent 体系架构](#agent-体系架构)
- [快速开始](#快速开始)
- [Agent 详细说明](#agent-详细说明)
- [记忆系统](#记忆系统)
- [开发工作流](#开发工作流)
- [同步与提交 Agent 文件](#同步与提交-agent-文件)
- [目录结构](#目录结构)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)

---

## 概述

本项目使用 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 的 Agent 能力，建立了一套多角色协作的 AI 辅助开发流程。核心思路是：

- **架构师 (Architect)** 负责需求分析、方案设计、任务分发
- **后端 Agent (Backend)** 专注 Python FastAPI + MLIR Bindings 开发
- **前端 Agent (Frontend)** 专注 React + TypeScript 开发
- **Git 操作员 (Git Operator)** 处理版本控制相关操作
- **Bug 定位器 (Bug Localizer)** 系统化诊断 bug 并定位根因

所有 Agent 共享一套**持久化记忆系统**，跨会话积累项目经验。

---

## Agent 体系架构

```
用户需求
  │
  ▼
┌──────────────┐
│  /architect  │  ← 架构师：需求分析 → 方案设计 → 计划制定 → 任务分发
└──────┬───────┘
       │
  ┌────┴────┐
  ▼         ▼
┌──────┐ ┌──────┐
│/back │ │/front│  ← 实现者：按计划编码、测试、更新记忆
│ end  │ │ end  │
└──┬───┘ └──┬───┘
   │        │
   ▼        ▼
┌──────────────┐
│ git-operator │  ← 自动 Agent：提交代码、管理分支
└──────────────┘

Bug 报告 → bug-localizer → 分析报告 → architect → 修复计划
```

### Agent 类型

| Agent | 类型 | 触发方式 | 说明 |
|-------|------|----------|------|
| 架构师 | Slash Command | `/architect <需求>` | 用户主动调用 |
| 后端 | Slash Command | `/backend <任务>` | 用户或架构师调用 |
| 前端 | Slash Command | `/frontend <任务>` | 用户或架构师调用 |
| Git 操作员 | 自动 Agent | 用户提及 git 操作时自动激活 | 系统自动调用 |
| Bug 定位器 | 自动 Agent | 用户报告 bug 时自动激活 | 系统自动调用 |

---

## 快速开始

### 前置条件

**方式一：直接使用 Anthropic API（推荐）**

1. 安装 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)：
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. 设置 Anthropic API Key：
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

**方式二：使用 [Claude Code Router](https://github.com/musistudio/claude-code-router)（支持多模型供应商）**

Claude Code Router 是一个代理工具，支持将 Claude Code 请求路由到不同的模型供应商（OpenRouter、DeepSeek、Ollama、Gemini 等），适合需要灵活切换模型或降低成本的场景。

1. 安装 Claude Code 和 Router：
   ```bash
   npm install -g @anthropic-ai/claude-code
   npm install -g @musistudio/claude-code-router
   ```

2. 配置 Router（`~/.claude-code-router/config.json`）：
   ```json
   {
     "providers": [
       {
         "name": "openrouter",
         "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
         "api_key": "$OPENROUTER_API_KEY",
         "models": ["anthropic/claude-sonnet-4", "anthropic/claude-haiku-4"]
       }
     ],
     "router": {
       "default": "openrouter/anthropic/claude-sonnet-4",
       "background": "openrouter/anthropic/claude-haiku-4"
     }
   }
   ```

3. 启动 Router 并使用：
   ```bash
   # 启动 Router 服务
   ccr code

   # 或激活环境变量后直接使用 claude 命令
   eval "$(ccr activate)"
   claude
   ```

4. Router 常用命令：
   ```bash
   ccr ui        # 打开 Web 配置界面
   ccr model     # 交互式切换模型
   ccr restart   # 配置修改后重启
   ```

> 更多 Router 配置详情请参考 [Claude Code Router 文档](https://github.com/musistudio/claude-code-router)。

### 一键部署 Agent 配置

克隆项目后，运行一键部署脚本将 Agent 配置和记忆系统部署到工作目录：

```bash
# 一键部署（不覆盖已有文件）
./scripts/setup-agents.sh

# 强制覆盖已有文件（用 docs/agents/ 中的版本替换）
./scripts/setup-agents.sh --force
```

> `.claude/` 和 `.mem/` 目录在 `.gitignore` 中被忽略，因此部署后的文件是本地工作副本，不会被误提交。

脚本会自动完成以下操作：

| 源文件 | 部署位置 |
|--------|----------|
| `docs/agents/commands/*.md` | `.claude/commands/` |
| `docs/agents/agents/git-operator.md` | `.claude/agents/` |
| `docs/agents/agents/bug-localizer.md` | `frontend/.claude/agents/` |
| `docs/agents/memory/shared/*` | `.mem/shared/` |
| `docs/agents/memory/backend/*` | `.mem/backend/` |
| `docs/agents/memory/frontend/*` | `.mem/frontend/` |
| `docs/agents/memory/plans/*` | `.mem/plans/` |

### 第一次使用

```bash
# 启动 Claude Code
claude

# 使用架构师规划一个新功能
> /architect 添加一个批量删除节点的功能

# 直接让后端 Agent 完成一个具体任务
> /backend 在 ir_manager.py 中添加 batch_delete_ops 方法

# 直接让前端 Agent 完成一个具体任务
> /frontend 在 GraphView 中添加多选节点功能

# Git 操作（自动识别）
> 帮我提交当前的修改
> 创建一个新分支 feature/batch-delete
```

---

## Agent 详细说明

### 1. 架构师 Agent (`/architect`)

**角色**：项目的技术领导，负责将用户需求转化为可执行的开发计划。

**工作流程**：
1. **读取上下文**：自动读取 `.mem/` 中的项目上下文和 Agent 记忆
2. **需求澄清**：向用户提问，明确功能边界和技术约束
3. **方案设计**：分析影响范围（后端端点、前端组件、数据模型）
4. **计划制定**：生成结构化计划文件，存入 `.mem/plans/`
5. **任务分发**：确认后自动调用 `/backend` 和 `/frontend` Agent

**使用场景**：
- 新功能开发（需要前后端协作）
- 架构级重构
- 需求不明确，需要分析和澄清

**示例**：
```
> /architect 在图上支持拖拽连线来添加 operand

架构师会：
1. 分析需要修改的文件（GraphView.tsx, api.ts, edit.py, ir_manager.py）
2. 设计前后端接口约定
3. 生成计划文件 .mem/plans/plan-YYYY-MM-DD-drag-connect.md
4. 询问确认后，依次调用 /backend 和 /frontend
```

**配置文件**：[commands/architect.md](commands/architect.md)

---

### 2. 后端 Agent (`/backend`)

**角色**：Python 后端开发专家，精通 FastAPI 和 MLIR Python Bindings。

**核心能力**：
- FastAPI 路由和 Pydantic 模型开发
- MLIR Python Bindings 操作（熟知所有常见坑点）
- IRManager 核心引擎扩展
- pytest 测试编写

**关键规范**（Agent 自动遵守）：
- MLIR `OpView` vs `Operation` 区别（`.operation.name` 获取类型名）
- Wrapper 同一性用 `==` 不用 `id()`
- 每次 mutation：快照 → 变更 → rebuild_graph → 验证
- 新端点遵循现有路由命名风格

**示例**：
```
> /backend 添加一个 PATCH /api/op/{op_id}/move 端点，支持将 op 移动到指定 block 的指定位置
```

**配置文件**：[commands/backend.md](commands/backend.md)

---

### 3. 前端 Agent (`/frontend`)

**角色**：React + TypeScript 前端开发专家。

**核心能力**：
- React 19 函数式组件开发
- XYFlow (React Flow) v12 图形渲染
- Ant Design 6 UI 组件使用
- ELK 布局算法配置
- vitest 测试编写

**关键规范**（Agent 自动遵守）：
- TypeScript 严格模式，禁止 `any`
- 全局状态在 `App.tsx`，通过 props 传递
- 新增 API 调用必须在 `api.ts` 封装
- 新增类型必须在 `ir.ts` 定义

**示例**：
```
> /frontend 在 PropertyPanel 中添加一个 "复制 op" 按钮，点击后调用 POST /api/op/clone
```

**配置文件**：[commands/frontend.md](commands/frontend.md)

---

### 4. Git 操作员 (自动 Agent)

**角色**：专业的 Git 工程师，自动处理所有版本控制操作。

**触发方式**：用户提及 git 相关操作时**自动激活**，无需手动调用。

**安全机制**：
- 破坏性操作前必须确认（force push、reset --hard 等）
- 操作前先 `git status` 确认状态
- 提交信息遵循项目 Conventional Commits 风格

**示例**：
```
> 帮我提交当前的修改          → 自动执行 git add + commit
> 创建一个新分支 feature/xxx  → 自动执行 git checkout -b
> 查看最近的提交记录          → 自动执行 git log
```

**配置文件**：[agents/git-operator.md](agents/git-operator.md)

---

### 5. Bug 定位器 (自动 Agent)

**角色**：专业的调试专家，系统化诊断 bug 并定位根因。

**触发方式**：用户报告 bug 或异常行为时**自动激活**。

**工作流程**：
1. 理解 bug 现象（预期 vs 实际）
2. 定位问题区域（IRManager / IR→Flow 转换 / API 路由 / 方言注册 / 历史系统）
3. 分析根因
4. 输出诊断报告（问题描述、根因、代码位置、修复建议）

**示例**：
```
> 我加了一个 arith.addf 节点后，图上没有显示连线
  → Bug 定位器自动分析：irToFlow.ts 的边生成逻辑 → 检查 operand 解析 → 定位问题
```

**配置文件**：[agents/bug-localizer.md](agents/bug-localizer.md)

---

## 记忆系统

Agent 记忆系统是跨会话知识积累的核心机制。

### 结构

```
.mem/
├── shared/project-context.md    # 全局上下文：技术栈、文件路径、API 端点、架构要点
├── backend/MEMORY.md            # 后端经验：MLIR Bindings 坑点、测试模式、已知 bug
├── frontend/MEMORY.md           # 前端经验：布局算法、组件模式、状态管理技巧
└── plans/
    ├── README.md                # 计划索引（含状态跟踪）
    └── plan-YYYY-MM-DD-*.md     # 各功能的详细计划
```

### 记忆内容说明

| 文件 | 读者 | 内容 |
|------|------|------|
| `shared/project-context.md` | 所有 Agent | 技术栈版本、关键文件路径、API 端点列表、架构决策 |
| `backend/MEMORY.md` | 后端 Agent | MLIR Bindings 注意事项、测试 fixtures、历史 bug 修复经验 |
| `frontend/MEMORY.md` | 前端 Agent | 组件模式、布局算法演进历史、React/XYFlow 技巧 |
| `plans/README.md` | 架构师 | 所有计划的状态索引 |
| `plans/plan-*.md` | 架构师、实现 Agent | 具体功能的需求、接口约定、任务列表、验收标准 |

### 记忆更新规则

- **Agent 自动更新**：每个 Agent 完成任务后，会自动将新发现的模式和经验写入对应的 MEMORY.md
- **架构师维护计划**：架构师负责创建和更新 `.mem/plans/` 中的计划文件
- **不记录临时信息**：当前任务细节、进行中的状态不写入记忆
- **去重和校正**：发现错误记忆时及时更新或删除

---

## 开发工作流

### 场景 1：开发新功能（全栈）

```
1. /architect 我想添加一个XXX功能
   ↓ 架构师分析需求、设计方案、生成计划
   ↓ 用户确认计划

2. 架构师自动分发任务：
   → /backend 实现后端 API（含测试）
   → /frontend 实现前端 UI（含测试）

3. 开发完成后：
   > 帮我提交代码   → git-operator 自动处理
```

### 场景 2：修复 Bug

```
1. 用户描述 bug：
   > 创建 arith.addf 后图上不显示连线
   ↓ bug-localizer 自动激活，分析根因

2. 根据诊断结果：
   > /backend 修复 ir_manager.py 中的 operand 解析逻辑
   或
   > /frontend 修复 irToFlow.ts 中的边生成逻辑

3. 修复完成后提交
```

### 场景 3：单端修改

```
# 只改后端
> /backend 在 validate() 方法中添加对 operand 类型的检查

# 只改前端
> /frontend 给 OpNode 添加双击展开 region 的功能
```

### 场景 4：代码审查和重构

```
> /architect 审查当前的 IRManager 代码，看看有没有可以优化的地方
  ↓ 架构师分析代码结构，提出优化建议
  ↓ 用户确认后分发重构任务
```

---

## 同步与提交 Agent 文件

Agent 的配置和记忆文件位于 `.claude/` 和 `.mem/`（已 gitignore），而 `docs/agents/` 是它们的 git 可追踪副本。

### 工作流

```
docs/agents/ ──(setup-agents.sh)──→ .claude/ + .mem/   （部署到本地）
.claude/ + .mem/ ──(sync-agents.sh)──→ docs/agents/     （同步回 git）
```

### 将本地修改同步回 git

当你修改了 Agent 配置（如调整了 architect.md 的工作流程）或积累了新的记忆，使用同步脚本将变更同步回 `docs/agents/`：

```bash
# 同步文件（只复制有变化的文件）
./scripts/sync-agents.sh

# 同步并自动提交
./scripts/sync-agents.sh --commit
```

脚本会自动：
1. 对比 `.claude/` 和 `.mem/` 中的文件与 `docs/agents/` 中的副本
2. 仅复制有变化的文件
3. 显示同步了哪些文件
4. （`--commit` 模式下）自动 `git add` + `git commit`

### 典型场景

**场景 A：新团队成员入职**
```bash
git clone <repo>
cd mlir-modifier
./scripts/setup-agents.sh   # 一键部署所有 Agent 配置
claude                       # 开始开发
```

**场景 B：改进了 Agent 配置后分享给团队**
```bash
# 编辑了 .claude/commands/backend.md，增加了新的规范...
./scripts/sync-agents.sh --commit   # 同步回 docs/ 并提交
git push                             # 推送给团队
```

**场景 C：更新团队最新的 Agent 配置**
```bash
git pull                              # 拉取最新代码
./scripts/setup-agents.sh --force     # 用最新 docs/agents/ 覆盖本地配置
```

---

## 目录结构

```
docs/agents/
├── README.md                       # 本文件：使用指南
├── commands/
│   ├── architect.md                # 架构师 Agent 配置
│   ├── backend.md                  # 后端 Agent 配置
│   └── frontend.md                 # 前端 Agent 配置
├── agents/
│   ├── git-operator.md             # Git 操作员配置
│   └── bug-localizer.md            # Bug 定位器配置
└── memory/
    ├── shared/
    │   └── project-context.md      # 项目全局上下文（参考样本）
    ├── backend/
    │   └── MEMORY.md               # 后端记忆（参考样本）
    ├── frontend/
    │   └── MEMORY.md               # 前端记忆（参考样本）
    └── plans/
        ├── README.md               # 计划索引（参考样本）
        └── plan-*.md               # 历史计划文件（参考样本）

scripts/
├── setup-agents.sh                 # 一键部署脚本
└── sync-agents.sh                  # 同步提交脚本
```

---

## 最佳实践

### 1. 复杂功能先找架构师

不要直接让后端或前端 Agent 做跨层的功能。先用 `/architect` 分析需求、确定接口约定，再分发任务。

### 2. 任务描述要具体

```
# 差：模糊的描述
> /backend 添加删除功能

# 好：具体的描述
> /backend 添加 DELETE /api/op/{op_id} 端点，支持 cascade=true/false 参数，
>   cascade=true 时级联删除所有依赖当前 op 结果的下游 op，
>   cascade=false 时只删除当前 op 并将引用其结果的 operand 断开
```

### 3. 善用 Bug 定位器

遇到 bug 时，不要直接猜测原因并手动修改。让 Bug 定位器系统化分析，往往能更准确地找到根因。

### 4. 及时提交

每完成一个独立功能就提交，不要积累大量修改。Git 操作员会自动生成符合规范的 commit message。

### 5. 定期同步 Agent 文件

修改 Agent 配置或积累重要记忆后，运行 `./scripts/sync-agents.sh --commit` 同步并提交，让团队共享最新的 Agent 经验。

### 6. 检查记忆文件

如果 Agent 的行为不符合预期，检查 `.mem/` 中的记忆文件是否包含过时或错误的信息。记忆会影响 Agent 的决策。

---

## 常见问题

### Q: Agent 配置文件不生效？

确保文件放置在正确的位置：
- Slash Commands: `.claude/commands/<name>.md`
- 自动 Agents: `.claude/agents/<name>.md`（或子目录的 `.claude/agents/`）

运行 `./scripts/setup-agents.sh` 可自动部署到正确位置。

### Q: 记忆文件太长怎么办？

MEMORY.md 超过 200 行会被截断。将详细内容拆分到独立文件（如 `debugging.md`、`patterns.md`），在 MEMORY.md 中只保留索引链接。

### Q: 架构师分发的任务不准确？

在架构师生成计划后、分发任务前，仔细审查计划内容。选择"需要调整"来修正计划。

### Q: Agent 之间如何共享信息？

通过 `.mem/` 记忆系统。所有 Agent 启动时会读取 `shared/project-context.md` 获取全局上下文，以及自己角色的 MEMORY.md 获取专业经验。

### Q: 如何自定义 Agent？

直接编辑对应的 `.claude/commands/<name>.md` 或 `.claude/agents/<name>.md`。修改后在下次 Agent 调用时生效。改好后运行 `./scripts/sync-agents.sh` 同步回 `docs/agents/` 以便团队共享。

### Q: 使用 Claude Code Router 时 Agent 功能是否完全兼容？

是的。Claude Code Router 只替换底层的 API 供应商，Agent 配置、记忆系统、Slash Command 等功能不受影响。但不同模型能力可能有差异，建议关键的架构设计任务仍使用 Claude 系列模型。
