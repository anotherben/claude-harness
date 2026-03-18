#!/bin/bash
# PreToolUse:Bash hook — enforces agent output review before merging agent branches.
# Blocks git merge of agent/fix/feat branches unless output was checked first.
#
# Part of the fleet-commander skill package.

HOOK_INPUT=$(cat)
SESSION_ID=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
COMMAND=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

[ -z "$SESSION_ID" ] && exit 0

# Only check git merge of agent branches
case "$COMMAND" in
  *"git merge"*"fix/"*|*"git merge"*"fix2/"*|*"git merge"*"fix3/"*|*"git merge"*"feat/"*)
    ;;
  *) exit 0 ;;
esac

# Extract branch name
BRANCH=$(echo "$COMMAND" | grep -oE '(fix|fix2|fix3|feat)/[^ ]+' | head -1)
[ -z "$BRANCH" ] && exit 0

# Check if output was reviewed (flag set by fleet commander after reading agent output)
REVIEW_FLAG="/tmp/claude-agent-reviewed-${SESSION_ID}-$(echo "$BRANCH" | tr '/' '-')"

if [ ! -f "$REVIEW_FLAG" ]; then
  echo "AGENT OUTPUT REVIEW REQUIRED before merging '$BRANCH'."
  echo ""
  echo "Before merging an agent's work:"
  echo "  1. Read the agent's output: agent-deck session output <session-name> -q"
  echo "  2. Check what files changed: cd <worktree> && git diff --stat HEAD~1"
  echo "  3. Verify tests pass ON THE BRANCH: cd <worktree> && npx jest --no-coverage"
  echo "  4. Then mark as reviewed:"
  echo "     touch $REVIEW_FLAG"
  echo ""
  echo "After review, retry this merge."
  exit 2
fi

exit 0
