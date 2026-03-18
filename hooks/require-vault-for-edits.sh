#!/bin/bash
# PreToolUse:Edit|Write — BLOCK source file edits without vault context
# Ensures work is tracked in Obsidian before any code changes begin.
# Exit 2 = BLOCKED. No bypass.

HOOK_TMP=$(mktemp /tmp/claude-hook-XXXXXX)
cat > "$HOOK_TMP"
trap "rm -f '$HOOK_TMP'" EXIT

SESSION_ID=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

FILE=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('tool_input',{}).get('file_path',''))" 2>/dev/null)
if [ -z "$FILE" ]; then exit 0; fi

# Only gate source files
if ! echo "$FILE" | grep -qE '\.(js|jsx|ts|tsx)$'; then
  exit 0
fi

# Skip infra files — hooks, skills, plans, evidence, config
if echo "$FILE" | grep -qE '\.claude/(hooks|skills|plans|evidence|worktrees|enterprise-state)/'; then
  exit 0
fi

# Skip test files — allow writing tests before vault context in edge cases? No.
# Tests are code too. Gate them.

# Check for vault-context marker
MARKER="/tmp/claude-vault-context-${SESSION_ID}"
if [ -f "$MARKER" ]; then
  exit 0
fi

echo "BLOCKED: No vault context loaded." >&2
echo "Run /vault-context or /vault-capture before editing source files." >&2
echo "Every code change must be backed by a vault item." >&2
exit 2
