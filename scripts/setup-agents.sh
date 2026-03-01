#!/usr/bin/env bash
# setup-agents.sh — 从 docs/agents/ 一键部署 Agent 配置和记忆系统到工作目录
#
# 用法：
#   ./scripts/setup-agents.sh          # 部署所有配置
#   ./scripts/setup-agents.sh --force  # 覆盖已有文件

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

FORCE=false
[[ "${1:-}" == "--force" ]] && FORCE=true

SRC="docs/agents"

if [[ ! -d "$SRC" ]]; then
    echo "错误：找不到 $SRC 目录，请确认在项目根目录运行" >&2
    exit 1
fi

copy_file() {
    local src="$1" dst="$2"
    mkdir -p "$(dirname "$dst")"
    if [[ -f "$dst" ]] && [[ "$FORCE" != true ]]; then
        echo "  跳过（已存在）：$dst"
    else
        cp "$src" "$dst"
        echo "  已部署：$dst"
    fi
}

echo "=== 部署 Agent 配置 ==="

# Slash Commands
for f in "$SRC"/commands/*.md; do
    [[ -f "$f" ]] || continue
    name="$(basename "$f")"
    copy_file "$f" ".claude/commands/$name"
done

# 自动 Agents
if [[ -f "$SRC/agents/git-operator.md" ]]; then
    copy_file "$SRC/agents/git-operator.md" ".claude/agents/git-operator.md"
fi
if [[ -f "$SRC/agents/bug-localizer.md" ]]; then
    copy_file "$SRC/agents/bug-localizer.md" "frontend/.claude/agents/bug-localizer.md"
fi

echo ""
echo "=== 部署记忆系统 ==="

# 共享上下文
for f in "$SRC"/memory/shared/*; do
    [[ -f "$f" ]] || continue
    copy_file "$f" ".mem/shared/$(basename "$f")"
done

# 后端记忆
for f in "$SRC"/memory/backend/*; do
    [[ -f "$f" ]] || continue
    copy_file "$f" ".mem/backend/$(basename "$f")"
done

# 前端记忆
for f in "$SRC"/memory/frontend/*; do
    [[ -f "$f" ]] || continue
    copy_file "$f" ".mem/frontend/$(basename "$f")"
done

# 计划文件
for f in "$SRC"/memory/plans/*; do
    [[ -f "$f" ]] || continue
    copy_file "$f" ".mem/plans/$(basename "$f")"
done

# 创建 Agent Memory 目录
mkdir -p .claude/agent-memory
mkdir -p frontend/.claude/agent-memory

echo ""
echo "=== 部署完成 ==="
echo ""
echo "提示：如需覆盖已有文件，请使用 --force 参数"
echo "      ./scripts/setup-agents.sh --force"
