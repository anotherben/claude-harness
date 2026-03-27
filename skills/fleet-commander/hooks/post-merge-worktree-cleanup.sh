#!/bin/bash
# PostToolUse:Bash hook — reminds to clean up worktrees after merges.
# Tracks merged branches and suggests cleanup when worktrees accumulate.
#
# Part of the fleet-commander skill package.

HOOK_INPUT=$(cat)
COMMAND=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

# Only check after git merge
case "$COMMAND" in
  *"git merge"*) ;;
  *) exit 0 ;;
esac

# Count active worktrees
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null)
if [ -n "$GIT_COMMON" ] && [ "$GIT_COMMON" != ".git" ]; then
  REPO_ROOT="$(cd "$(dirname "$GIT_COMMON")" && pwd)"
else
  REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
fi

WORKTREE_COUNT=$(git worktree list 2>/dev/null | grep -v "^$REPO_ROOT " | wc -l | tr -d ' ')

if [ "$WORKTREE_COUNT" -gt 5 ] 2>/dev/null; then
  echo "WORKTREE CLEANUP: $WORKTREE_COUNT active worktrees. After merging, clean up:"
  echo "  git worktree remove <path> --force   # for each merged worktree"
  echo "  fleet-cli remove <session>             # for each completed session"
  echo "  git worktree prune                    # clean stale references"
fi

exit 0
