#!/bin/bash
# PreToolUse:Bash — Two duties:
# 1. Drop a timestamp marker for the post-hook filesystem audit
# 2. BLOCK commands that WRITE to protected files
#
# IMPORTANT: This hook must distinguish between commands that MENTION
# protected paths (e.g. grep, git commit messages) vs commands that
# WRITE to them (cp, mv, sed -i, >, >>, tee, writeFileSync).

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

# --- Duty 2: Block WRITE operations targeting protected infrastructure ---
# Strategy: detect write verbs + protected paths in the same command.
# Read-only commands (grep, cat, diff, git log, git commit -m "text") are allowed
# even if they mention protected paths in arguments or message text.

PROTECTED_PATHS='\.git/hooks/|\.claude/hooks/|\.claude/settings\.json|\.claude/evidence/.*\.json'

# Write operation patterns — these verbs modify files
WRITE_VERBS='(^|\s|;|&&|\|)\s*(cp|mv|rm|sed\s+-i|chmod|chown|tee|install|rsync)\s'
REDIRECT_PATTERN='>\s*\S*('$PROTECTED_PATHS')'
WRITE_FILE_PATTERN='(writeFileSync|writeFile|open\(.*(w|a)\)|fs\.write)'

# Check 1: Write verb + protected path in same command
if echo "$COMMAND" | grep -qE "$WRITE_VERBS" && echo "$COMMAND" | grep -qE "$PROTECTED_PATHS"; then
  echo "BLOCKED: Write command targets protected infrastructure." >&2
  echo "Protected: .git/hooks/, .claude/hooks/, .claude/settings.json, .claude/evidence/*.json" >&2
  echo "Agents must not modify hooks, settings, or evidence files via Bash." >&2
  exit 2
fi

# Check 2: Redirect (> or >>) to protected path
if echo "$COMMAND" | grep -qE "$REDIRECT_PATTERN"; then
  echo "BLOCKED: Redirect targets protected infrastructure." >&2
  exit 2
fi

# Check 3: Node/Python file write to protected path
if echo "$COMMAND" | grep -qE "$WRITE_FILE_PATTERN" && echo "$COMMAND" | grep -qE "$PROTECTED_PATHS"; then
  echo "BLOCKED: Script writes to protected infrastructure." >&2
  exit 2
fi

# --- Duty 3: Block forgery of gate marker files ---
# touch/echo/printf targeting /tmp/claude-{plan-approved,vault-context,bash-pre}-*
if echo "$COMMAND" | grep -qE '(touch|echo|printf).*(/tmp/claude-(plan-approved|vault-context|bash-pre)-)'; then
  echo "BLOCKED: Command attempts to forge a gate marker file." >&2
  echo "Gate markers must be created by hooks, not by agent commands." >&2
  exit 2
fi

exit 0
