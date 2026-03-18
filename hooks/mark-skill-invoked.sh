#!/bin/bash
# PostToolUse hook — records skill invocations for session tracking.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi
SKILL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('skill','') or d.get('name',''))" 2>/dev/null)

if [ -n "$SKILL_NAME" ]; then
  SKILLS_FILE="/tmp/claude-skills-invoked-${SESSION_ID}"
  echo "$(date +%H:%M:%S) $SKILL_NAME" >> "$SKILLS_FILE"
  echo "Skill invoked: $SKILL_NAME"

  # Mark vault-context as loaded for enforce-vault-context.sh and require-vault-for-edits.sh gates
  # Both vault-context (load state) and vault-capture (create item) unlock editing
  if [ "$SKILL_NAME" = "vault-context" ] || [ "$SKILL_NAME" = "vault-capture" ]; then
    touch "/tmp/claude-vault-context-${SESSION_ID}"
  fi

  # Mark plan as approved for require-plan-before-edits.sh gate
  if [ "$SKILL_NAME" = "enterprise-plan" ] || [ "$SKILL_NAME" = "enterprise-contract" ] || [ "$SKILL_NAME" = "enterprise" ]; then
    touch "/tmp/claude-plan-approved-${SESSION_ID}"
  fi
fi
