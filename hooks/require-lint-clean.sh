#!/bin/bash
# PreToolUse hook — runs ESLint on staged source files before git commit.
# Only triggers on `git commit` commands. Skips if no staged source files.
# Exit 2 = block. Exit 0 = allow.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

# Only gate git commit commands
case "$COMMAND" in
  git\ commit*) ;;
  *) exit 0 ;;
esac

# Get staged source files (exclude tests, node_modules, .claude/)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E '\.(js|jsx|ts|tsx)$' | grep -v node_modules | grep -v __tests__ | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '\.claude/')

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Run ESLint on staged files (timeout handled by settings.json)
LINT_OUTPUT=$(echo "$STAGED_FILES" | xargs npx eslint --no-fix --quiet 2>&1)
LINT_EXIT=$?

if [ $LINT_EXIT -ne 0 ]; then
  echo "BLOCKED: ESLint errors in staged files. Fix before committing:"
  echo "$LINT_OUTPUT" | head -30
  exit 2
fi

exit 0
