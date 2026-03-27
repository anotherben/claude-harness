#!/bin/bash
# PostToolUse:Bash — Filesystem audit after every Bash command.
# Finds source files created/modified DURING this specific Bash command.
#
# How it works:
# 1. block-bash-file-writes.sh (PreToolUse) creates a fresh timestamp marker BEFORE each command
# 2. This hook (PostToolUse) finds files newer than that marker
# 3. After checking, it REFRESHES the marker so the next command gets a clean baseline
#
# This prevents false positives from Edit/Write changes made before the Bash command ran.

HOOK_TMP=$(mktemp /tmp/claude-hook-XXXXXX)
cat > "$HOOK_TMP"
trap "rm -f '$HOOK_TMP'" EXIT

SESSION_ID=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('session_id',''))" 2>/dev/null)
[ -z "$SESSION_ID" ] && exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

MARKER="/tmp/claude-bash-pre-${SESSION_ID}"

# No marker = PreToolUse hook didn't run
if [ ! -f "$MARKER" ]; then
  exit 0
fi

# Find source files newer than the marker (modified DURING this Bash command)
NEW_FILES=$(find "$PROJECT_DIR/apps" "$PROJECT_DIR/tools" "$PROJECT_DIR/packages" "$PROJECT_DIR/src" "$PROJECT_DIR/public" \
  \( -name node_modules -o -name .git -o -name dist -o -name .next -o -name .worktrees \) -prune -o \
  -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.html' \) \
  -newer "$MARKER" \
  -print \
  2>/dev/null)

# REFRESH the marker — this is the key fix.
# Each Bash command gets its own clean baseline. Without this,
# Edit/Write changes from before this command would be caught as false positives.
touch "$MARKER"

# No new/modified source files — all clear
if [ -z "$NEW_FILES" ]; then
  exit 0
fi

# Source files were modified DURING this Bash command.
# This means a Bash command (script, node, python, etc.) wrote source files,
# bypassing Edit/Write hooks. Block and revert.

COUNT=$(echo "$NEW_FILES" | wc -l | tr -d ' ')
echo "BLOCKED: Bash command modified ${COUNT} source file(s) during execution." >&2
echo "Source files must be modified via Edit/Write tools (which enforce TDD, vault, plan hooks)." >&2
echo "Modified files:" >&2
echo "$NEW_FILES" | head -10 | while IFS= read -r f; do echo "  $f" >&2; done
echo "" >&2
echo "Reverting changes..." >&2
echo "$NEW_FILES" | while IFS= read -r filepath; do
  [ -z "$filepath" ] && continue
  git -C "$PROJECT_DIR" checkout -- "$filepath" 2>/dev/null && echo "  REVERTED: $filepath" >&2
done
exit 2
