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

# Check for plan approval marker
if [ -f "/tmp/claude-plan-approved-${SESSION_ID}" ]; then
  exit 0
fi

echo "BLOCKED: Source file edit requires an approved plan. Run /enterprise (which includes planning) or /enterprise-plan first. No code without a plan."
exit 2
