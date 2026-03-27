#!/bin/bash
# PreToolUse:Edit|Write|MultiEdit hook — blocks source edits outside a registered dispatch lane.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/fleet-common.sh"

HOOK_INPUT=$(cat)
FILE_PATH=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('file_path',''))" 2>/dev/null)

case "$FILE_PATH" in
  *.test.js|*.test.jsx|*.test.ts|*.test.tsx|*.spec.js|*.spec.jsx|*.spec.ts|*.spec.tsx) exit 0 ;;
  *__tests__/*) exit 0 ;;
  *.json|*.md|*.sql|*.sh|*.css|*.html|*.env*) exit 0 ;;
  *.js|*.jsx|*.ts|*.tsx|*.py) ;;
  *) exit 0 ;;
esac

GIT_DIR=$(git rev-parse --git-dir 2>/dev/null || true)
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null || true)
if [ -z "$GIT_DIR" ] || [ -z "$GIT_COMMON" ] || [ "$GIT_DIR" = "$GIT_COMMON" ] || [ "$GIT_DIR" = ".git" ]; then
  echo "DISPATCH GATE: source edits must happen in a dedicated git worktree registered to a dispatch run."
  echo "Primary checkout edits are blocked."
  exit 2
fi

SESSION_TITLE="$(current_fleet_session)"
[ -n "$SESSION_TITLE" ] || {
  echo "DISPATCH GATE: no active fleet session is bound to this Claude worker."
  echo "Use the registered dispatch wrappers to open a run and launch a worker first."
  exit 2
}

REPO_ROOT="$(current_repo_root)"
WORKTREE_ROOT="$(current_worktree_root)"
BRANCH="$(current_branch_name)"

CHECK_JSON=$(check_registered_dispatch_lane "$SESSION_TITLE" "$REPO_ROOT" "$BRANCH" "$WORKTREE_ROOT")
CHECK_OK=$(printf '%s' "$CHECK_JSON" | python3 -c 'import json,sys; data=json.load(sys.stdin); print("1" if data.get("ok") and data.get("result", {}).get("ok") else "")' 2>/dev/null || true)
if [ -z "$CHECK_OK" ]; then
  echo "DISPATCH GATE: current lane is not registered for repo-changing work."
  echo "$CHECK_JSON"
  exit 2
fi

exit 0
