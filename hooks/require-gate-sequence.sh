#!/bin/bash
# PreToolUse hook — enforces superpowers gate sequence before source edits.
# Blocks Edit/Write on source .js/.jsx files unless Gate 1 skill was invoked.
#
# Gate sequences (from CLAUDE.md):
#   Feature:  brainstorming → writing-plans → subagent-driven-development → verification
#   Bug fix:  systematic-debugging → test-driven-development → subagent-driven-development → verification
#   Refactor: brainstorming → writing-plans → subagent-driven-development → verification
#
# This hook enforces: at least one Gate 1 skill must be invoked before any source edit.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('file_path','') or d.get('command',''))" 2>/dev/null)

# Only check JS/JSX source files
case "$FILE_PATH" in
  *.test.js|*.test.jsx|*.spec.js|*.spec.jsx) exit 0 ;;
  *__tests__/*) exit 0 ;;
  *.json|*.md|*.sql|*.sh|*.css|*.html|*.env*|*.png|*.jpg) exit 0 ;;
  *.js|*.jsx) ;; # continue to check
  *) exit 0 ;;
esac

# Only enforce for superpowers methodology
METHODOLOGY=$(cat "/tmp/claude-methodology-${SESSION_ID}" 2>/dev/null)
if [ "$METHODOLOGY" != "superpowers" ]; then
  exit 0
fi

# Check skills-invoked file exists
SKILLS_FILE="/tmp/claude-skills-invoked-${SESSION_ID}"
if [ ! -f "$SKILLS_FILE" ]; then
  echo "BLOCKED: Superpowers Gate 1 not completed — no skills invoked yet."
  echo ""
  echo "Before editing source files, invoke a Gate 1 skill:"
  echo "  Feature/Refactor: superpowers:brainstorming"
  echo "  Bug fix:          superpowers:systematic-debugging"
  exit 2
fi

# Check Gate 1: at least one process skill invoked
GATE1_SKILLS="brainstorming|systematic-debugging"
if ! grep -qE "$GATE1_SKILLS" "$SKILLS_FILE" 2>/dev/null; then
  echo "BLOCKED: Superpowers Gate 1 not completed."
  echo ""
  echo "Before editing source files, invoke a Gate 1 skill:"
  echo "  Feature/Refactor: superpowers:brainstorming"
  echo "  Bug fix:          superpowers:systematic-debugging"
  echo ""
  echo "Skills invoked so far:"
  cat "$SKILLS_FILE"
  exit 2
fi

exit 0
