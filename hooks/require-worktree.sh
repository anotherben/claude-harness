#!/bin/bash
# PreToolUse hook — blocks source edits when not in a git worktree.
# Enforces isolation: all non-trivial work should happen in worktrees.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('file_path',''))" 2>/dev/null)

# Only check JS/JSX source files
case "$FILE_PATH" in
  *.test.js|*.test.jsx|*.spec.js|*.spec.jsx) exit 0 ;;
  *__tests__/*) exit 0 ;;
  *.json|*.md|*.sql|*.sh|*.css|*.html|*.env*) exit 0 ;;
  *.js|*.jsx) ;; # continue
  *) exit 0 ;;
esac

# Check if we're in a worktree (not the main repo)
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null)
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null)
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)

# If git-dir != git-common-dir, we're in a worktree — OK
if [ "$GIT_DIR" != "$GIT_COMMON" ] && [ "$GIT_DIR" != ".git" ]; then
  exit 0
fi

# On main repo — check if branch is dev/main/master (block) or feature branch (allow)
BRANCH=$(git branch --show-current 2>/dev/null)
case "$BRANCH" in
  dev|main|master)
    echo "WARNING: Editing source on '$BRANCH' without a worktree."
    echo "Consider: git worktree add .worktrees/feat-name -b feat/name $BRANCH"
    # Warning only — not blocking to avoid breaking fleet commander workflows
    exit 0
    ;;
esac

exit 0
