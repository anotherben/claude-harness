#!/bin/bash
# PreToolUse:Bash — Two duties:
# 1. Drop a timestamp marker for the post-hook filesystem audit
# 2. BLOCK commands that target protected files (.git/hooks, .claude/hooks, .claude/settings.json)

HOOK_TMP=$(mktemp /tmp/claude-hook-XXXXXX)
cat > "$HOOK_TMP"
trap "rm -f '$HOOK_TMP'" EXIT

SESSION_ID=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('session_id',''))" 2>/dev/null)
[ -z "$SESSION_ID" ] && exit 0

COMMAND=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('tool_input',{}).get('command',''))" 2>/dev/null)

# --- Duty 1: Timestamp marker for post-hook audit ---
MARKER="/tmp/claude-bash-pre-${SESSION_ID}"
if [ ! -f "$MARKER" ]; then
  PAST=$(date -v-2S +%Y%m%d%H%M.%S 2>/dev/null || date -d '-2 seconds' +%Y%m%d%H%M.%S 2>/dev/null)
  touch -t "$PAST" "$MARKER" 2>/dev/null || touch "$MARKER"
fi

# --- Duty 2: Block commands targeting protected infrastructure ---
PROTECTED_PATTERN='\.git/hooks/|\.claude/hooks/|\.claude/settings\.json|\.claude/evidence/.*\.json'

if echo "$COMMAND" | grep -qE "$PROTECTED_PATTERN"; then
  # Allow read-only commands (cat, head, grep, diff, ls, stat)
  FIRST_CMD=$(echo "$COMMAND" | sed 's/[;&|].*//' | awk '{print $1}')
  case "$FIRST_CMD" in
    cat|head|tail|grep|rg|diff|ls|stat|wc|file|python3)
      ;;
    *)
      echo "BLOCKED: Command targets protected infrastructure." >&2
      echo "Protected: .git/hooks/, .claude/hooks/, .claude/settings.json, .claude/evidence/*.json" >&2
      echo "Agents must not modify hooks, settings, or evidence files via Bash." >&2
      exit 2
      ;;
  esac
fi

# Block touch/echo targeting gate marker files (forging markers)
if echo "$COMMAND" | grep -qE '(touch|echo|printf).*(/tmp/claude-(plan-approved|vault-context|bash-pre)-)'; then
  echo "BLOCKED: Command attempts to forge a gate marker file." >&2
  echo "Gate markers must be created by hooks, not by agent commands." >&2
  exit 2
fi

exit 0
