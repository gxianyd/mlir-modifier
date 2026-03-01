#!/usr/bin/env bash
# sync-agents.sh — 将工作目录中的 Agent 配置和记忆同步回 docs/agents/ 以便提交到 git
#
# 用法：
#   ./scripts/sync-agents.sh           # 同步所有文件
#   ./scripts/sync-agents.sh --commit  # 同步后自动提交

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

AUTO_COMMIT=false
[[ "${1:-}" == "--commit" ]] && AUTO_COMMIT=true

DST="docs/agents"
CHANGED=0

sync_file() {
    local src="$1" dst="$2"
    if [[ ! -f "$src" ]]; then
        return
    fi
    mkdir -p "$(dirname "$dst")"
    if [[ -f "$dst" ]] && diff -q "$src" "$dst" >/dev/null 2>&1; then
        return  # 无变化
    fi
    cp "$src" "$dst"
    echo "  已同步：$src → $dst"
    CHANGED=$((CHANGED + 1))
}

echo "=== 同步 Agent 配置 → docs/agents/ ==="

# Slash Commands
for f in .claude/commands/*.md; do
    [[ -f "$f" ]] || continue
    name="$(basename "$f")"
    sync_file "$f" "$DST/commands/$name"
done

# 自动 Agents
sync_file ".claude/agents/git-operator.md" "$DST/agents/git-operator.md"
sync_file "frontend/.claude/agents/bug-localizer.md" "$DST/agents/bug-localizer.md"

echo ""
echo "=== 同步记忆系统 → docs/agents/memory/ ==="

# 共享上下文
for f in .mem/shared/*; do
    [[ -f "$f" ]] || continue
    sync_file "$f" "$DST/memory/shared/$(basename "$f")"
done

# 后端记忆
for f in .mem/backend/*; do
    [[ -f "$f" ]] || continue
    sync_file "$f" "$DST/memory/backend/$(basename "$f")"
done

# 前端记忆
for f in .mem/frontend/*; do
    [[ -f "$f" ]] || continue
    sync_file "$f" "$DST/memory/frontend/$(basename "$f")"
done

# 计划文件
for f in .mem/plans/*; do
    [[ -f "$f" ]] || continue
    sync_file "$f" "$DST/memory/plans/$(basename "$f")"
done

echo ""
if [[ $CHANGED -eq 0 ]]; then
    echo "=== 所有文件已是最新，无需同步 ==="
else
    echo "=== 共同步 $CHANGED 个文件 ==="

    if [[ "$AUTO_COMMIT" == true ]]; then
        echo ""
        echo "=== 自动提交 ==="
        git add "$DST/"
        git commit -m "docs(agents): sync agent configs and memory snapshots"
        echo "已提交。"
    else
        echo ""
        echo "提示：运行以下命令提交更改："
        echo "  git add docs/agents/ && git commit -m 'docs(agents): sync agent configs and memory'"
        echo ""
        echo "或使用 --commit 参数自动提交："
        echo "  ./scripts/sync-agents.sh --commit"
    fi
fi
