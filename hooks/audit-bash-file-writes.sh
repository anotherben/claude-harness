#!/bin/bash
# PostToolUse:Bash — Filesystem audit after every Bash command.
# Finds source files created/modified AFTER the PreToolUse timestamp marker.
# If gates aren't satisfied, new files are DELETED and the hook exits 2.
#
# Unforgeable: doesn't parse commands. Watches the filesystem.
# cp, python, node, dd, install, tee, heredoc — all caught.

HOOK_TMP=$(mktemp /tmp/claude-hook-XXXXXX)
cat > "$HOOK_TMP"
trap "rm -f '$HOOK_TMP'" EXIT

SESSION_ID=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('session_id',''))" 2>/dev/null)
[ -z "$SESSION_ID" ] && exit 0

# Resolve project dir — CLAUDE_PROJECT_DIR may not be set in hook context
# Fall back to the directory containing the .claude/ folder
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

MARKER="/tmp/claude-bash-pre-${SESSION_ID}"

# Debug log
DEBUG_LOG="/tmp/claude-audit-debug.log"
echo "$(date): audit hook fired, session=$SESSION_ID marker=$MARKER marker_exists=$([ -f "$MARKER" ] && echo Y || echo N) project_dir=$PROJECT_DIR" >> "$DEBUG_LOG"

# No marker = PreToolUse hook didn't run
if [ ! -f "$MARKER" ]; then
  echo "$(date): no marker, exiting" >> "$DEBUG_LOG"
  exit 0
fi

# Find source files newer than the marker
# MUST be fast (<2s) — prune heavy dirs aggressively
# Scans ALL source directories including public/ for CSS/HTML
NEW_FILES=$(find "$PROJECT_DIR/apps" "$PROJECT_DIR/tools" "$PROJECT_DIR/packages" "$PROJECT_DIR/src" "$PROJECT_DIR/public" \
  \( -name node_modules -o -name .git -o -name dist -o -name .next -o -name .worktrees \) -prune -o \
  -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.html' \) \
  -newer "$MARKER" \
  -print \
  2>/dev/null)

# DO NOT delete the marker here — the pre-hook manages its lifecycle
# (only creates if absent). Deleting here causes the next command's
# audit to have no marker, missing files written by that command.

echo "$(date): found files: $(echo "$NEW_FILES" | wc -l | tr -d ' ') — '$(echo "$NEW_FILES" | head -1)'" >> "$DEBUG_LOG"

# No new/modified source files — all clear
if [ -z "$NEW_FILES" ]; then
  echo "$(date): no new files, exiting" >> "$DEBUG_LOG"
  exit 0
fi

# Source files were created/modified. Check gates.
VAULT_MARKER="/tmp/claude-vault-context-${SESSION_ID}"
PLAN_MARKER="/tmp/claude-plan-approved-${SESSION_ID}"

GATES_OK=true
MISSING=""
if [ ! -f "$VAULT_MARKER" ]; then GATES_OK=false; MISSING="vault-context"; fi
if [ ! -f "$PLAN_MARKER" ]; then GATES_OK=false; MISSING="${MISSING:+$MISSING, }plan-approval"; fi

if [ "$GATES_OK" = true ]; then
  # Gates pass but Bash was used instead of Edit/Write — BLOCK.
  # Edit/Write tools have TDD, vault, plan, and protect-files hooks.
  # Bash scripts bypass ALL of those. Force the proper tool.
  COUNT=$(echo "$NEW_FILES" | wc -l | tr -d ' ')
  echo "BLOCKED: Bash modified ${COUNT} source file(s). Use Edit/Write tools instead." >&2
  echo "Bash bypasses TDD, vault, plan, and file-protection hooks." >&2
  echo "Modified files:" >&2
  echo "$NEW_FILES" | head -10 | while IFS= read -r f; do echo "  $f" >&2; done
  echo "" >&2
  echo "Reverting changes..." >&2
  # Revert modified files via git checkout
  echo "$NEW_FILES" | while IFS= read -r filepath; do
    [ -z "$filepath" ] && continue
    git -C "$PROJECT_DIR" checkout -- "$filepath" 2>/dev/null && echo "  REVERTED: $filepath" >&2
  done
  exit 2
fi

# Gates FAIL — quarantine new files
QUARANTINE="$PROJECT_DIR/.claude/quarantine"
mkdir -p "$QUARANTINE" 2>/dev/null

echo "BLOCKED: Bash command created/modified source files without gates." >&2
echo "Missing: ${MISSING}" >&2
echo "" >&2

echo "$NEW_FILES" | while IFS= read -r filepath; do
  [ -z "$filepath" ] && continue
  # Move to quarantine, preserving relative path as filename
  RELATIVE="${filepath#$PROJECT_DIR/}"
  SAFE_NAME=$(echo "$RELATIVE" | tr '/' '_')
  mv "$filepath" "$QUARANTINE/$SAFE_NAME" 2>/dev/null && echo "  QUARANTINED: $filepath → .claude/quarantine/$SAFE_NAME" >&2
done

echo "" >&2
echo "Files moved to .claude/quarantine/ (recoverable, not deleted)." >&2
echo "Fix: run /vault-context, get plan approved, then use the Write tool." >&2
exit 2
