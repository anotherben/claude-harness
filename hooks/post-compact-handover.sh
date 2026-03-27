#!/bin/bash
# PostCompact hook — forces handover write when auto-compact fires.
# Manual compacts get a reminder. Auto compacts get a stronger push.

HOOK_INPUT=$(cat)
TRIGGER=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('trigger','unknown'))" 2>/dev/null)
SESSION_ID=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)

# Track compaction count
COMPACT_COUNT_FILE="/tmp/claude-compact-count-${SESSION_ID}"
if [ -f "$COMPACT_COUNT_FILE" ]; then
  COUNT=$(cat "$COMPACT_COUNT_FILE")
else
  COUNT=0
fi
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COMPACT_COUNT_FILE"

if [ "$TRIGGER" = "auto" ]; then
  echo "AUTO-COMPACT DETECTED (compaction #${COUNT}). Context is getting full."
  echo ""
  if [ "$COUNT" -ge 2 ]; then
    echo "CRITICAL: This is compaction #${COUNT}. You MUST write a handover NOW:"
    echo "  Use /handover-writer to save progress before context is lost."
    echo "  Include: what's done, what's in progress, what's blocked, fleet state."
  else
    echo "Write a handover soon — use /handover-writer if switching tasks or context is heavy."
  fi
  echo ""
  echo "Also: save important decisions to memory (MEMORY.md)."
  echo ""
  echo "ACTIVITY LOG: Write a session activity entry to ${OBSIDIAN_VAULT_PATH:-~/Documents/Vault}/_activity/"
  echo "  Filename: $(date +%Y-%m-%d-%H%M%S)-claude-session.md"
  echo "  Include: items worked on, completed, pending, decisions, and side-thoughts."
  echo "  Frontmatter: type: activity-log, agent: claude, project: {project}, session_start/end timestamps."
elif [ "$TRIGGER" = "manual" ]; then
  echo "Manual compact. If you're switching tasks, consider /handover-writer."
fi

exit 0
