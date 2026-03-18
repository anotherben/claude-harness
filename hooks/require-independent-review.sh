#!/bin/bash
# PreToolUse hook — prevents builder from reviewing own work.
# When enterprise-review is invoked, checks if enterprise-build was also
# invoked in the same session. If yes and no enterprise orchestrator -> block.
# Exit 2 = block. Exit 0 = allow.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

SKILL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('skill',''))" 2>/dev/null)

# Only gate enterprise-review
if [ "$SKILL_NAME" != "enterprise-review" ]; then
  exit 0
fi

SKILLS_FILE="/tmp/claude-skills-invoked-${SESSION_ID}"
if [ ! -f "$SKILLS_FILE" ]; then
  exit 0
fi

# Check if enterprise-build was invoked in this session
if grep -q "enterprise-build" "$SKILLS_FILE"; then
  # Allow if enterprise orchestrator is running (it dispatches both build and review)
  if grep -q "^[0-9:]* enterprise$" "$SKILLS_FILE"; then
    exit 0
  fi
  echo "BLOCKED: Builder cannot review own work. enterprise-build was invoked in this session — enterprise-review must run in a separate agent or via /enterprise orchestrator."
  exit 2
fi

exit 0
