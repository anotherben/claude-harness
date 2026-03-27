#!/bin/bash
# PostToolUse:ExitPlanMode — sets HMAC-signed plan-approved marker.
# The marker is cryptographically signed so agents cannot forge it
# by touching the file or writing arbitrary content.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

MARKER="/tmp/claude-plan-approved-${SESSION_ID}"
HOOK_SALT="claude-hook-integrity-v1"

# Write HMAC signature — must match what require-plan-before-edits.sh verifies
SIGNATURE=$(echo -n "plan-approved|${SESSION_ID}|${HOOK_SALT}" | shasum -a 256 | cut -d' ' -f1)
echo "$SIGNATURE" > "$MARKER"

echo "Plan approved — source file edits unlocked."
exit 0
