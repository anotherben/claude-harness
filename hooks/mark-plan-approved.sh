#!/bin/bash
# PostToolUse:ExitPlanMode — sets plan-approved marker when plan mode exits.
# This allows source file edits after a plan has been reviewed and approved.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

touch "/tmp/claude-plan-approved-${SESSION_ID}"
echo "Plan approved — source file edits unlocked."
exit 0
