#!/bin/bash
# PreToolUse hook — blocks source file edits unless a plan has been approved.
# Checks for /tmp/claude-plan-approved-${SESSION_ID} marker.
# Skips .claude/ infra files, test files, and non-source files.
# Exit 2 = block. Exit 0 = allow.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)
if [ -z "$FILE_PATH" ]; then exit 0; fi

# Skip non-source files
case "$FILE_PATH" in
  *.js|*.jsx|*.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# Skip .claude/ infra files
case "$FILE_PATH" in
  *.claude/*) exit 0 ;;
esac

# Skip test files
case "$FILE_PATH" in
  *__tests__*|*.test.*|*.spec.*) exit 0 ;;
esac

# Check for plan approval marker (HMAC-signed by mark-skill-invoked.sh)
HOOK_SALT="claude-hook-integrity-v1"
PLAN_MARKER="/tmp/claude-plan-approved-${SESSION_ID}"
if [ -f "$PLAN_MARKER" ]; then
  STORED_SIG=$(cat "$PLAN_MARKER" 2>/dev/null | tr -d '[:space:]')
  EXPECTED_SIG=$(echo -n "plan-approved|${SESSION_ID}|${HOOK_SALT}" | shasum -a 256 | cut -d' ' -f1)
  if [ "$STORED_SIG" = "$EXPECTED_SIG" ]; then
    exit 0
  elif [ -z "$STORED_SIG" ]; then
    # Empty marker (from touch) — BLOCKED. Must be HMAC-signed.
    echo "BLOCKED: Plan approval marker exists but is unsigned. Agents cannot forge plan approval with touch." >&2
    rm -f "$PLAN_MARKER"
  else
    echo "BLOCKED: Plan approval marker has INVALID signature — was it hand-written by an agent?" >&2
    rm -f "$PLAN_MARKER"
  fi
fi

echo "BLOCKED: Source file edit requires an approved plan. Run /enterprise (which includes planning) or /enterprise-plan first. No code without a plan."
exit 2
