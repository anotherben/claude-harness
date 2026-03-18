#!/bin/bash
# PreToolUse:Skill — remind agent to load vault context before enterprise work
# Checks if /vault-context has been invoked this session.
# If not, warns (does not block) when /enterprise is invoked.

HOOK_TMP=$(mktemp /tmp/claude-hook-XXXXXX)
cat > "$HOOK_TMP"
trap "rm -f '$HOOK_TMP'" EXIT

SESSION_ID=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

# Check which skill is being invoked
SKILL_NAME=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('tool_input',{}).get('skill',''))" 2>/dev/null)

# Only gate on enterprise skill
case "$SKILL_NAME" in
  enterprise|enterprise-build|enterprise-plan|enterprise-contract|enterprise-brainstorm)
    ;;
  *)
    exit 0
    ;;
esac

# Check if vault-context was already loaded this session
MARKER="/tmp/claude-vault-context-${SESSION_ID}"
if [ -f "$MARKER" ]; then
  exit 0
fi

# Hard block — no enterprise work without vault context
echo "BLOCKED: Vault context not loaded for this session." >&2
echo "Run /vault-context before /enterprise to load project state." >&2
echo "This ensures you have current vault items, claims, and standards." >&2
exit 2
