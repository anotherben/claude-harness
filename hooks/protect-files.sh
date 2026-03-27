#!/bin/bash
# PreToolUse hook — blocks edits to protected files
# Protected: .env, .env.local, middleware/auth.js
# These require explicit user approval before modification

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
FILE=""

if [ "$TOOL" = "Edit" ] || [ "$TOOL" = "str_replace" ] || [ "$TOOL" = "Write" ]; then
  FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
fi

if [ -z "$FILE" ]; then
  exit 0
fi

# Check against protected file patterns
if echo "$FILE" | grep -qE '(\.env$|\.env\.local$|middleware/auth\.js$|\.claude/evidence/|_evidence/)'; then
  echo "BLOCKED: $FILE is a protected file. Ask user before editing." >&2
  exit 2
fi

# Protect git hooks from agent modification
if echo "$FILE" | grep -qE '\.git/hooks/'; then
  echo "BLOCKED: $FILE is a git hook. Agents must not modify git hooks." >&2
  exit 2
fi

# Protect global Claude infrastructure from agent modification
if echo "$FILE" | grep -qE '/\.claude/hooks/|/\.claude/settings\.json$'; then
  echo "BLOCKED: $FILE is Claude infrastructure. Agents must not modify hooks or global settings." >&2
  exit 2
fi

exit 0
