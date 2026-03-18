#!/bin/bash
# PostToolUse hook — tracks tool call count and gives soft reminders.
# Hard enforcement is in context-gate.sh (PreToolUse blocker).

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

COUNTER_FILE="/tmp/claude-fade-${SESSION_ID}"

if [ -f "$COUNTER_FILE" ]; then
  COUNT=$(cat "$COUNTER_FILE")
else
  COUNT=0
fi

COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

# Soft reminders only — hard blocking is in context-gate.sh
if [ $((COUNT % 20)) -eq 0 ] && [ "$COUNT" -ge 60 ]; then
  echo "Session depth: $COUNT tool calls. Save important decisions to the knowledge graph as you go."
fi

exit 0
