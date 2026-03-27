#!/bin/bash
# PreToolUse:Skill — require vault context before enterprise work
# The /enterprise ORCHESTRATOR is allowed through — it handles vault context internally.
# Individual enterprise stages (/enterprise-build, etc.) are hard-blocked without it.

HOOK_TMP=$(mktemp /tmp/claude-hook-XXXXXX)
cat > "$HOOK_TMP"
trap "rm -f '$HOOK_TMP'" EXIT

SESSION_ID=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

SKILL_NAME=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('tool_input',{}).get('skill',''))" 2>/dev/null)

# Allow the orchestrator through — it auto-handles vault context
if [ "$SKILL_NAME" = "enterprise" ]; then
  exit 0
fi

# Only gate enterprise sub-stages
case "$SKILL_NAME" in
  enterprise-build|enterprise-plan|enterprise-contract|enterprise-brainstorm|enterprise-review|enterprise-forge|enterprise-verify|enterprise-compound|enterprise-debug|enterprise-discover|enterprise-harness)
    ;;
  *)
    exit 0
    ;;
esac

# Check if vault-context was already loaded this session
MARKER="/tmp/claude-vault-context-${SESSION_ID}"

if [ -f "$MARKER" ]; then
  MARKER_AGE=$(( $(date +%s) - $(stat -f %m "$MARKER" 2>/dev/null || stat -c %Y "$MARKER" 2>/dev/null || echo 0) ))
  if [ "$MARKER_AGE" -gt 7200 ]; then
    rm -f "$MARKER"
  fi
fi
if [ -f "$MARKER" ]; then
  exit 0
fi

echo "BLOCKED: Vault context not loaded for this session." >&2
echo "Run /vault-context before enterprise sub-stages." >&2
echo "Or run /enterprise which handles this automatically." >&2
exit 2
