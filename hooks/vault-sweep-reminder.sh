#!/bin/bash
# SessionStart hook — warns if vault sweep is overdue (>7 days).
# Non-blocking (exit 0 always) but prominent warning.

LAST_SWEEP_FILE="/tmp/claude-vault-last-sweep"

# Suggest morning briefing if it hasn't been run this session
if [ ! -f /tmp/claude-last-morning-briefing ]; then
  echo "TIP: Start your day with /morning-briefing for a full status overview."
fi

if [ ! -f "$LAST_SWEEP_FILE" ]; then
  echo "VAULT SWEEP NEEDED: No sweep has ever been run. Run /vault-sweep to review stale items and get accountability."
  exit 0
fi

LAST_SWEEP=$(cat "$LAST_SWEEP_FILE" 2>/dev/null)
NOW=$(date +%s)
LAST_TS=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${LAST_SWEEP%%Z*}" "+%s" 2>/dev/null || echo "0")

if [ "$LAST_TS" = "0" ]; then
  echo "VAULT SWEEP NEEDED: Last sweep timestamp unreadable. Run /vault-sweep."
  exit 0
fi

AGE_DAYS=$(( (NOW - LAST_TS) / 86400 ))

if [ "$AGE_DAYS" -ge 7 ]; then
  echo "VAULT SWEEP OVERDUE: Last sweep was $AGE_DAYS days ago. Run /vault-sweep to review stale items, escalate priorities, and check dead branches."
fi

exit 0
