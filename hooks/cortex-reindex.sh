#!/bin/bash
# PostToolUse:Edit|Write hook — triggers jcodemunch incremental reindex after source file edits.
# jcodemunch does NOT auto-update. This hook ensures the index stays fresh.

HOOK_INPUT=$(cat)
FILE_PATH=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('file_path',''))" 2>/dev/null)

# Only reindex for source files
case "$FILE_PATH" in
  *.test.js|*.test.jsx|*.spec.js|*.spec.jsx) exit 0 ;;
  *__tests__/*) exit 0 ;;
  *.json|*.md|*.sql|*.sh|*.css|*.html|*.env*) exit 0 ;;
  *.js|*.jsx|*.ts|*.tsx) ;; # source files — reindex
  *) exit 0 ;;
esac

# Tell the agent to reindex (non-blocking message, not a command execution)
echo "jcodemunch index may be stale after this edit. Run: mcp__jcodemunch__index_folder(path=\"\$CLAUDE_PROJECT_DIR\", incremental=true) before your next symbol lookup."
exit 0
