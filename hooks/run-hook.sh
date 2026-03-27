#!/bin/bash
# Hook resolver — finds the repo root and runs the named hook from .claude/hooks/
# Usage: run-hook.sh <hook-name.sh>
# Works from any worktree or subdirectory.

HOOK_NAME="$1"
if [ -z "$HOOK_NAME" ]; then
  echo "Usage: run-hook.sh <hook-name>" >&2
  exit 1
fi

# Try $CLAUDE_PROJECT_DIR first
if [ -n "$CLAUDE_PROJECT_DIR" ] && [ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/$HOOK_NAME" ]; then
  exec "$CLAUDE_PROJECT_DIR/.claude/hooks/$HOOK_NAME"
fi

# Walk up from CWD to find .claude/hooks/
DIR="$(pwd)"
while [ "$DIR" != "/" ]; do
  if [ -f "$DIR/.claude/hooks/$HOOK_NAME" ]; then
    exec "$DIR/.claude/hooks/$HOOK_NAME"
  fi
  DIR="$(dirname "$DIR")"
done

# Try git toplevel (works in worktrees — git-common-dir points to main repo)
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null)
if [ -n "$GIT_COMMON" ] && [ "$GIT_COMMON" != ".git" ]; then
  REPO_ROOT="$(dirname "$GIT_COMMON")"
  if [ -f "$REPO_ROOT/.claude/hooks/$HOOK_NAME" ]; then
    exec "$REPO_ROOT/.claude/hooks/$HOOK_NAME"
  fi
fi

# Last resort — user-level hooks
if [ -f "$HOME/.claude/hooks/$HOOK_NAME" ]; then
  exec "$HOME/.claude/hooks/$HOOK_NAME"
fi

# Hook not found — exit silently (don't block)
exit 0
