#!/bin/bash
# PreToolUse:Bash — Three duties:
# 1. Drop a timestamp marker for the post-hook filesystem audit
# 2. BLOCK commands that WRITE to protected files (unless elevated)
# 3. BLOCK forgery of gate marker files
#
# Elevation: user runs `claude-unlock` for a one-time 6-digit code.
# Agent includes ELEVATE=<code> anywhere in the command to bypass.

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

# --- Elevation check function ---
check_elevation() {
  ELEVATE_FILE="/tmp/claude-unlock"
  [ ! -f "$ELEVATE_FILE" ] && return 1

  STORED=$(cat "$ELEVATE_FILE" 2>/dev/null)
  STORED_CODE=$(echo "$STORED" | cut -d'|' -f1)
  STORED_EXPIRY=$(echo "$STORED" | cut -d'|' -f2)
  NOW=$(date +%s)

  # Check expiry
  if [ -n "$STORED_EXPIRY" ] && [ "$NOW" -gt "$STORED_EXPIRY" ]; then
    rm -f "$ELEVATE_FILE"
    return 1
  fi

  # Check if command contains ELEVATE=<code>
  AGENT_CODE=$(echo "$COMMAND" | grep -oE 'ELEVATE=[0-9]{6}' | head -1 | cut -d= -f2)
  if [ "$AGENT_CODE" = "$STORED_CODE" ]; then
    rm -f "$ELEVATE_FILE"  # Burn the code
    echo "ELEVATED: Code verified. Protected write allowed (one-time)." >&2
    return 0
  fi

  return 1
}

# --- Duty 2: Block WRITE operations targeting protected infrastructure ---
PROTECTED_PATHS='\.git/hooks/|\.claude/hooks/|\.claude/settings\.json|\.claude/evidence/.*\.json'
WRITE_VERBS='(^|\s|;|&&|\|)\s*(cp|mv|rm|sed\s+-i|chmod|chown|tee|install|rsync)\s'
REDIRECT_PATTERN='>\s*\S*('$PROTECTED_PATHS')'
WRITE_FILE_PATTERN='(writeFileSync|writeFile|open\(.*(w|a)\)|fs\.write)'

NEEDS_ELEVATION=false

# Check 1: Write verb + protected path
if echo "$COMMAND" | grep -qE "$WRITE_VERBS" && echo "$COMMAND" | grep -qE "$PROTECTED_PATHS"; then
  NEEDS_ELEVATION=true
fi

# Check 2: Redirect to protected path
if echo "$COMMAND" | grep -qE "$REDIRECT_PATTERN"; then
  NEEDS_ELEVATION=true
fi

# Check 3: Script file write to protected path
if echo "$COMMAND" | grep -qE "$WRITE_FILE_PATTERN" && echo "$COMMAND" | grep -qE "$PROTECTED_PATHS"; then
  NEEDS_ELEVATION=true
fi

if [ "$NEEDS_ELEVATION" = true ]; then
  if check_elevation; then
    exit 0  # Elevated — allow
  fi
  echo "BLOCKED: Write command targets protected infrastructure." >&2
  echo "Protected: .git/hooks/, .claude/hooks/, .claude/settings.json, .claude/evidence/*.json" >&2
  echo "To allow: user runs 'claude-unlock', then gives the code to the agent." >&2
  exit 2
fi

# --- Duty 3: Block forgery of gate marker files (never elevatable) ---
if echo "$COMMAND" | grep -qE '(touch|echo|printf).*(/tmp/claude-(plan-approved|vault-context|bash-pre)-)'; then
  echo "BLOCKED: Command attempts to forge a gate marker file." >&2
  echo "Gate markers must be created by hooks, not by agent commands. No elevation available." >&2
  exit 2
fi

exit 0
