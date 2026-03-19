#!/bin/bash
# PreToolUse:Read hook - ENFORCES cortex-engine for source file reads.
# Blocks Read on source files >50 lines. Forces agents to use cortex-engine MCP.
# Only allows Read when file is small or non-source (configs, tests, docs, etc).

HOOK_INPUT=$(cat)
FILE_PATH=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('file_path','') or d.get('path',''))" 2>/dev/null)

case "$FILE_PATH" in
  *.test.js|*.test.jsx|*.spec.js|*.spec.jsx) exit 0 ;;
  *__tests__/*) exit 0 ;;
  *.json|*.md|*.sql|*.sh|*.css|*.html|*.env*|*.yml|*.yaml|*.toml) exit 0 ;;
  *.png|*.jpg|*.svg|*.gif|*.pdf) exit 0 ;;
  *node_modules*) exit 0 ;;
  *.js|*.jsx|*.ts|*.tsx) ;;
  *) exit 0 ;;
esac

[ ! -f "$FILE_PATH" ] && exit 0

LINES=$(wc -l < "$FILE_PATH" 2>/dev/null)
if [ "$LINES" -le 50 ] 2>/dev/null; then
  exit 0
fi

HAS_OFFSET=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print('yes' if d.get('offset') else 'no')" 2>/dev/null)
if [ "$HAS_OFFSET" = "yes" ]; then
  exit 0
fi

echo "BLOCKED: Use cortex-engine MCP instead of Read for source files (${LINES} lines)."
echo ""
echo "  1. mcp__cortex-engine__cortex_outline(file_path=\"...\") - see all symbols"
echo "  2. mcp__cortex-engine__cortex_read_symbol(file_path=\"...\", symbol_name=\"...\") - read one symbol"
echo "  3. mcp__cortex-engine__cortex_find_symbol(query=\"...\") - search by name"
echo ""
echo "If results seem stale, run:"
echo "  mcp__cortex-engine__cortex_reindex()"
echo ""
echo "Only use Read with offset+limit when you need to edit a specific section."
exit 2
