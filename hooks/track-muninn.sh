#!/bin/bash
# PostToolUse hook — tracks Muninn memory activity during the session.
# Records remember, remember_batch, evolve, link, forget calls.
# The pre-commit gate and session-end hook check this file.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)

MUNINN_FILE="/tmp/claude-muninn-activity-${SESSION_ID}"

case "$TOOL_NAME" in
  mcp__muninn__muninn_remember|mcp__muninn__muninn_remember_batch|mcp__muninn__muninn_evolve|mcp__muninn__muninn_link|mcp__muninn__muninn_forget|mcp__muninn__muninn_decide)
    echo "$(date +%H:%M:%S) $TOOL_NAME" >> "$MUNINN_FILE"
    ;;
esac

exit 0
