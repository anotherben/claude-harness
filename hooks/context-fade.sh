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

# Vault-aware nudges every 40 tool calls (starting at 40), rate-limited to once per 5 minutes
if [ $((COUNT % 40)) -eq 0 ] && [ "$COUNT" -ge 40 ]; then
  NUDGE_FILE="/tmp/claude-nudge-${SESSION_ID}"
  LAST_NUDGE=$(cat "$NUDGE_FILE" 2>/dev/null || echo "0")
  NOW=$(date +%s)
  if [ $((NOW - LAST_NUDGE)) -ge 300 ]; then
    echo "$NOW" > "$NUDGE_FILE"

    # Try to read nudge cache from morning briefing for targeted nudges
    CACHE="/tmp/claude-nudge-cache.json"
    if [ -f "$CACHE" ]; then
      INBOX=$(python3 -c "import json; print(json.load(open('$CACHE')).get('inbox_count',0))" 2>/dev/null || echo "0")
      STALE=$(python3 -c "import json; print(json.load(open('$CACHE')).get('stale_in_progress_count',0))" 2>/dev/null || echo "0")
      IDEAS=$(python3 -c "import json; print(json.load(open('$CACHE')).get('ideas_over_30d',0))" 2>/dev/null || echo "0")
      PARKED=$(python3 -c "import json; print(json.load(open('$CACHE')).get('parked_reminders_due',0))" 2>/dev/null || echo "0")

      CATEGORY=$(( RANDOM % 4 ))
      case $CATEGORY in
        0) [ "$INBOX" -gt 0 ] && echo "NUDGE: You have $INBOX items in inbox waiting for triage. /vault-triage when you have a moment." ;;
        1) [ "$STALE" -gt 0 ] && echo "NUDGE: $STALE in-progress items are going stale. /vault-status to check." ;;
        2) [ "$IDEAS" -gt 0 ] && echo "NUDGE: $IDEAS ideas have been sitting for 30+ days. Review or archive them?" ;;
        3) [ "$PARKED" -gt 0 ] && echo "NUDGE: $PARKED parked items have reminders due. /morning-briefing to review." ;;
      esac
    else
      # No cache — use generic rotation
      CATEGORY=$(( RANDOM % 4 ))
      case $CATEGORY in
        0) echo "NUDGE: Items in inbox may need triage. /vault-triage when you have a moment." ;;
        1) echo "NUDGE: Anything started but untouched for a while? /vault-status for a quick look." ;;
        2) echo "NUDGE: Brain feeling full? /brain-dump to offload whatever's rattling around." ;;
        3) echo "NUDGE: /park lets you shelve anything you're not doing today without losing it." ;;
      esac
    fi
  fi
fi

exit 0
