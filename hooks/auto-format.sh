#!/bin/bash
# PostToolUse hook — auto-format JS/JSX files after Edit/Write
# Runs ESLint --fix on the edited file to maintain consistent style

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
FILE=""

if [ "$TOOL" = "Edit" ] || [ "$TOOL" = "str_replace" ]; then
  FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
elif [ "$TOOL" = "Write" ]; then
  FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
fi

# Only lint JS/JSX files within the project
if [ -n "$FILE" ] && echo "$FILE" | grep -qE '\.(js|jsx)$'; then
  # Run ESLint fix silently — don't block on failure
  cd "$CLAUDE_PROJECT_DIR" && npx eslint --fix "$FILE" 2>/dev/null || true
fi

exit 0
