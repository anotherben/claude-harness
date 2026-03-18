#!/bin/bash
# PreToolUse:Read|Grep hook — ENFORCES jcodemunch for source file reads.
# Blocks Read on source files >50 lines. Forces agents to use jcodemunch MCP.
# Only allows Read when file is small or non-source (configs, tests, docs, etc).

HOOK_INPUT=$(cat)
TOOL_NAME=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)
FILE_PATH=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('file_path','') or d.get('path',''))" 2>/dev/null)

# Allow non-source files through
case "$FILE_PATH" in
  *.test.js|*.test.jsx|*.spec.js|*.spec.jsx) exit 0 ;;
  *__tests__/*) exit 0 ;;
  *.json|*.md|*.sql|*.sh|*.css|*.html|*.env*|*.yml|*.yaml|*.toml) exit 0 ;;
  *.png|*.jpg|*.svg|*.gif|*.pdf) exit 0 ;;
  *node_modules*) exit 0 ;;
  *.js|*.jsx|*.ts|*.tsx) ;; # source files — enforce jcodemunch
  *) exit 0 ;;
esac

# Allow if file doesn't exist (agent will get an error anyway)
[ ! -f "$FILE_PATH" ] && exit 0

# Allow small files (<50 lines) — not worth the jcodemunch overhead
LINES=$(wc -l < "$FILE_PATH" 2>/dev/null)
if [ "$LINES" -le 50 ] 2>/dev/null; then
  exit 0
fi

# Allow if offset/limit specified (agent is reading a specific section for editing)
HAS_OFFSET=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print('yes' if d.get('offset') else 'no')" 2>/dev/null)
if [ "$HAS_OFFSET" = "yes" ]; then
  exit 0
fi

# BLOCK: force jcodemunch for full source file reads
REPO="{{JCODEMUNCH_REPO_ID}}"
echo "BLOCKED: Use jcodemunch MCP instead of Read for source files (${LINES} lines)."
echo ""
echo "  1. mcp__jcodemunch__get_file_outline(repo=\"${REPO}\", file_path=\"...\") — see all functions"
echo "  2. mcp__jcodemunch__get_symbol(repo=\"${REPO}\", symbol_id=\"...\") — read one function"
echo "  3. mcp__jcodemunch__search_symbols(repo=\"${REPO}\", query=\"...\") — find by name"
echo ""
echo "If outline returns empty/no symbols -> index is stale. Run FIRST:"
echo "  mcp__jcodemunch__index_folder(path=\"\$CLAUDE_PROJECT_DIR\", incremental=true)"
echo "Then retry the outline/symbol lookup."
echo ""
echo "Only use Read with offset+limit when you need to edit a specific section."
exit 2
