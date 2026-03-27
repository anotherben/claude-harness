#!/bin/bash
# PostToolUse hook — auto-format source files after Edit/Write
# Runs prettier (if available) then eslint --fix (if available) on TS/JS files

INPUT=$(cat)
FILE=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)

# Only format source files within the project
if [ -n "$FILE" ] && echo "$FILE" | grep -qE '\.(ts|tsx|js|jsx)$'; then
  # Skip test files, node_modules, dist
  if echo "$FILE" | grep -qE '(node_modules|dist/|\.test\.|\.spec\.)'; then
    exit 0
  fi
  # Run prettier if available — don't block on failure
  cd "$CLAUDE_PROJECT_DIR" && npx prettier --write "$FILE" 2>/dev/null || true
  # Run eslint fix if available — don't block on failure
  cd "$CLAUDE_PROJECT_DIR" && npx eslint --fix "$FILE" 2>/dev/null || true
fi

exit 0
