#!/bin/bash
# PostToolUse:Edit|Write hook - reminder that cortex-engine has a real-time file watcher.
# This hook is a no-op for cortex but kept as a safety net in case the watcher falls behind.

HOOK_INPUT=$(cat)
FILE_PATH=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('file_path',''))" 2>/dev/null)

case "$FILE_PATH" in
  *.test.js|*.test.jsx|*.spec.js|*.spec.jsx) exit 0 ;;
  *__tests__/*) exit 0 ;;
  *.json|*.md|*.sql|*.sh|*.css|*.html|*.env*) exit 0 ;;
  *.js|*.jsx|*.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# cortex-engine has a real-time watcher - no manual reindex needed.
# If symbol lookups return stale data, run: mcp__cortex-engine__cortex_reindex()
exit 0
