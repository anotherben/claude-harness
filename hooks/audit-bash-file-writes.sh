#!/bin/bash
# PostToolUse:Bash — Filesystem audit after every Bash command.
# Finds source files created/modified DURING this specific Bash command.
#
# How it works:
# 1. block-bash-file-writes.sh (PreToolUse) creates a fresh timestamp marker BEFORE each command
# 2. This hook (PostToolUse) finds files newer than that marker
# 3. After checking, it REFRESHES the marker so the next command gets a clean baseline
#
# Whitelisted commands that legitimately modify source files:
# - git (pull, rebase, merge, checkout, stash, cherry-pick, reset)
# - build tools (npm run build, vite, tsc, webpack, esbuild, rollup)
# - package managers (npm install, yarn, pnpm)
# - test runners (vitest, jest, playwright — may generate snapshots)

HOOK_TMP=$(mktemp /tmp/claude-hook-XXXXXX)
cat > "$HOOK_TMP"
trap "rm -f '$HOOK_TMP'" EXIT

SESSION_ID=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('session_id',''))" 2>/dev/null)
[ -z "$SESSION_ID" ] && exit 0

COMMAND=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('tool_input',{}).get('command',''))" 2>/dev/null)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

MARKER="/tmp/claude-bash-pre-${SESSION_ID}"

# No marker = PreToolUse hook didn't run
if [ ! -f "$MARKER" ]; then
  exit 0
fi

# --- Whitelist: commands that legitimately modify source files ---
# These tools are expected to change files in the working tree.
# git operations (pull, rebase, merge, checkout, stash, cherry-pick, reset, restore)
if echo "$COMMAND" | grep -qE '^\s*git\s+(pull|rebase|merge|checkout|stash|cherry-pick|reset|restore|am|apply)\b'; then
  touch "$MARKER"
  exit 0
fi
# git -C variant
if echo "$COMMAND" | grep -qE '^\s*git\s+-C\s+\S+\s+(pull|rebase|merge|checkout|stash|cherry-pick|reset|restore|am|apply)\b'; then
  touch "$MARKER"
  exit 0
fi

# Build tools
if echo "$COMMAND" | grep -qE '(npm run build|npx vite|npx tsc|npx webpack|npx esbuild|npx rollup|yarn build|pnpm build|vite build)'; then
  touch "$MARKER"
  exit 0
fi

# Package managers (npm install can trigger postinstall scripts that generate files)
if echo "$COMMAND" | grep -qE '^\s*(npm install|npm ci|yarn install|yarn$|pnpm install)\b'; then
  touch "$MARKER"
  exit 0
fi

# Prisma generate / migrate
if echo "$COMMAND" | grep -qE '(npx prisma|prisma generate|prisma migrate)'; then
  touch "$MARKER"
  exit 0
fi

# Test runners (may generate snapshots, coverage reports)
if echo "$COMMAND" | grep -qE '(npx vitest|npx jest|npx playwright|npm test|npm run test)'; then
  touch "$MARKER"
  exit 0
fi

# --- Check for source file modifications ---
NEW_FILES=$(find "$PROJECT_DIR/apps" "$PROJECT_DIR/tools" "$PROJECT_DIR/packages" "$PROJECT_DIR/src" "$PROJECT_DIR/public" \
  \( -name node_modules -o -name .git -o -name dist -o -name .next -o -name .worktrees \) -prune -o \
  -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.html' \) \
  -newer "$MARKER" \
  -print \
  2>/dev/null)

# REFRESH the marker for the next command
touch "$MARKER"

# No new/modified source files — all clear
if [ -z "$NEW_FILES" ]; then
  exit 0
fi

# Source files were modified by a non-whitelisted Bash command.
COUNT=$(echo "$NEW_FILES" | wc -l | tr -d ' ')
echo "BLOCKED: Bash command modified ${COUNT} source file(s) during execution." >&2
echo "Source files must be modified via Edit/Write tools (which enforce TDD, vault, plan hooks)." >&2
echo "If this was a legitimate tool (build, git), report this as a hook whitelist gap." >&2
echo "Modified files:" >&2
echo "$NEW_FILES" | head -10 | while IFS= read -r f; do echo "  $f" >&2; done
echo "" >&2
echo "Reverting changes..." >&2
echo "$NEW_FILES" | while IFS= read -r filepath; do
  [ -z "$filepath" ] && continue
  git -C "$PROJECT_DIR" checkout -- "$filepath" 2>/dev/null && echo "  REVERTED: $filepath" >&2
done
exit 2
