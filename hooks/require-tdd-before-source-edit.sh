#!/bin/bash
# PreToolUse hook — methodology-aware TDD enforcement.
# Superpowers: BLOCKS source edits without recent tests. Compound: warns only.

# Read tool input from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('file_path','') or d.get('command',''))" 2>/dev/null)

# Skip non-JS source files, test files, config, migrations
case "$FILE_PATH" in
  *.test.js|*.test.jsx|*.spec.js|*.spec.jsx) exit 0 ;;
  *__tests__/*) exit 0 ;;
  *.json|*.md|*.sql|*.sh|*.css|*.html|*.env*) exit 0 ;;
  *.js|*.jsx) ;; # continue to check
  *) exit 0 ;;
esac

# Read methodology
METHODOLOGY_FILE="/tmp/claude-methodology-${SESSION_ID}"
if [ ! -f "$METHODOLOGY_FILE" ]; then
  echo "WARNING: No methodology set. Run session start to choose Superpowers or Compound Engineering."
  exit 0
fi

METHODOLOGY=$(cat "$METHODOLOGY_FILE")

# Check for recent test runs (within last 10 minutes)
MARK_FILE="/tmp/claude-test-ran-${SESSION_ID}"
TESTS_RECENT=false
if [ -f "$MARK_FILE" ]; then
  MARK_AGE=$(( $(date +%s) - $(stat -f %m "$MARK_FILE" 2>/dev/null || echo 0) ))
  if [ "$MARK_AGE" -lt 600 ]; then
    TESTS_RECENT=true
  fi
fi

# Check for staged test files
STAGED_TESTS=$(git diff --cached --name-only 2>/dev/null | grep -c '\.test\.\|\.spec\.\|__tests__' || true)

if [ "$TESTS_RECENT" = true ] || [ "$STAGED_TESTS" -gt 0 ]; then
  exit 0
fi

if [ "$METHODOLOGY" = "superpowers" ]; then
  echo "BLOCKED: Superpowers methodology requires tests before source edits."
  echo "Run tests first (npx jest) or write a test file, then retry."
  exit 2
elif [ "$METHODOLOGY" = "compound" ]; then
  echo "NOTE: No recent test run detected. Consider writing tests."
  exit 0
else
  exit 0
fi
