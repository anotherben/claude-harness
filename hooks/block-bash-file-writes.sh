#!/bin/bash
# PreToolUse:Bash — Drop a timestamp marker before each command.
# Only creates the marker if one doesn't already exist (the post-hook deletes it).

HOOK_TMP=$(mktemp /tmp/claude-hook-XXXXXX)
cat > "$HOOK_TMP"
trap "rm -f '$HOOK_TMP'" EXIT

SESSION_ID=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('session_id',''))" 2>/dev/null)
[ -z "$SESSION_ID" ] && exit 0

MARKER="/tmp/claude-bash-pre-${SESSION_ID}"

# Only create if doesn't exist — post-hook deletes it after each check
if [ ! -f "$MARKER" ]; then
  # Backdate 2 seconds so find -newer catches same-second writes
  PAST=$(date -v-2S +%Y%m%d%H%M.%S 2>/dev/null || date -d '-2 seconds' +%Y%m%d%H%M.%S 2>/dev/null)
  touch -t "$PAST" "$MARKER" 2>/dev/null || touch "$MARKER"
fi

exit 0
