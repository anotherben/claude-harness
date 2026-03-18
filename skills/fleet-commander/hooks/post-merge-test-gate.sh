#!/bin/bash
# PostToolUse:Bash hook — tracks merge events and enforces test-before-next-merge.
# After a git merge, sets a flag. Next git merge is blocked until tests pass.
#
# Part of the fleet-commander skill package.

HOOK_INPUT=$(cat)
SESSION_ID=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
COMMAND=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null)

[ -z "$SESSION_ID" ] && exit 0

MERGE_FLAG="/tmp/claude-merge-pending-test-${SESSION_ID}"

# After a merge command, set the "needs test" flag
case "$COMMAND" in
  *"git merge"*)
    echo "$(date +%s)" > "$MERGE_FLAG"
    echo "POST-MERGE: Tests required before next merge. Run the test suite now."
    ;;
esac

# After tests run successfully, clear the merge flag
case "$COMMAND" in
  *"npx jest"*|*"npm test"*|*"vitest"*|*"pytest"*|*"go test"*|*"cargo test"*)
    if [ -f "$MERGE_FLAG" ]; then
      rm -f "$MERGE_FLAG"
    fi
    ;;
esac

exit 0
