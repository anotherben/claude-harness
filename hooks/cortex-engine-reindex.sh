#!/bin/bash
# PostToolUse:Edit|Write hook — reminds the agent to refresh cortex-engine after source edits.
# cortex-engine must be reindexed after edits to keep symbol lookups accurate.

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
echo "cortex-engine index may be stale after this edit. Run: cortex_reindex(file_path=\"$FILE_PATH\") before your next symbol lookup."
exit 0
