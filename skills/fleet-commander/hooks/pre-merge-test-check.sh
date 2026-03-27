#!/bin/bash
# PreToolUse:Bash hook — blocks git merge if previous merge hasn't been tested.
# Works with post-merge-test-gate.sh to enforce test-between-merges.
#
# Part of the fleet-commander skill package.

HOOK_INPUT=$(cat)
SESSION_ID=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
COMMAND=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

[ -z "$SESSION_ID" ] && exit 0

# Only check git merge commands
case "$COMMAND" in
  *"git merge"*) ;;
  *) exit 0 ;;
esac

MERGE_FLAG="/tmp/claude-merge-pending-test-${SESSION_ID}"

if [ -f "$MERGE_FLAG" ]; then
  echo "BLOCKED: Previous merge has not been tested yet."
  echo ""
  echo "You must run tests after each merge before doing another merge."
  echo ""
  echo "If tests pass, the block clears automatically. Then retry this merge."
  exit 2
fi

exit 0
