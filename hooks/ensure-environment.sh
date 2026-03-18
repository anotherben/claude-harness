#!/bin/bash
# SessionStart hook — ensures skills are installed and environment is ready.
# Runs at session start. Fast no-op if everything is already set up.

HOOK_INPUT=$(cat)
SESSION_ID=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then SESSION_ID="unknown"; fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
CHANGED=()

# 1. Install utility skills from project to user-level
for skill in run-verification create-migration senior-architect session-heartbeat scope-check deploy-checklist handover-writer; do
  if [ ! -f ~/.claude/skills/$skill/SKILL.md ] && [ -f "$PROJECT_DIR/.claude/skills/$skill/SKILL.md" ]; then
    mkdir -p ~/.claude/skills/$skill
    cp "$PROJECT_DIR/.claude/skills/$skill/SKILL.md" ~/.claude/skills/$skill/
    CHANGED+=("skill:$skill")
  fi
done

# Report
if [ ${#CHANGED[@]} -gt 0 ]; then
  echo "Environment setup: ${CHANGED[*]}"
else
  exit 0
fi
