#!/bin/bash
# Fleet status dashboard — run with: bash fleet-dashboard.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/fleet-common.sh"

echo "═══════════════════════════════════════════════"
echo "  FLEET DASHBOARD — $(date '+%Y-%m-%d %H:%M')"
echo "═══════════════════════════════════════════════"
echo ""

echo "FLEET CLI:"
"$FLEET_CLI_BIN" status 2>&1 | head -3
echo ""

echo "ORCHESTRATOR:"
registry_cli get-orchestrator \
  --profile-name "$ORCHESTRATOR_PROFILE" \
  --conductor-name "$ORCHESTRATOR_NAME" \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); orch=(data.get("result") or {}); print(json.dumps(orch, indent=2))'
echo ""

echo "OPEN DISPATCH RUNS:"
registry_cli list-dispatch-runs --status open \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); runs=(data.get("result") or [])[:10]; print(json.dumps(runs, indent=2))'
echo ""

echo "SESSIONS:"
"$FLEET_CLI_BIN" list 2>&1 | grep -v "^Profile:" | grep -v "^$" | grep -v "^Total:" | grep -v "Update available"
echo ""

echo "WORKTREES:"
WORKTREE_COUNT=$(git worktree list 2>/dev/null | wc -l | tr -d ' ')
echo "  Total: $WORKTREE_COUNT"
git worktree list 2>/dev/null | grep -v "$(git rev-parse --show-toplevel 2>/dev/null) " | while read -r line; do
  path=$(echo "$line" | awk '{print $1}')
  branch=$(echo "$line" | grep -oE '\[.*\]')
  if [ -d "$path" ]; then
    changes=$(cd "$path" && git status --short 2>/dev/null | wc -l | tr -d ' ')
    if [ "$changes" -gt 0 ]; then
      echo "  $branch — $changes uncommitted changes"
    else
      committed=$(cd "$path" && git log --oneline -1 2>/dev/null)
      echo "  $branch — $committed"
    fi
  fi
done
echo ""

echo "═══════════════════════════════════════════════"
