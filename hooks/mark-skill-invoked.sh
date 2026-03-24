#!/bin/bash
# PostToolUse hook — records skill invocations for session tracking and telemetry.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi
SKILL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('skill','') or d.get('name',''))" 2>/dev/null)

if [ -n "$SKILL_NAME" ]; then
  SKILLS_FILE="/tmp/claude-skills-invoked-${SESSION_ID}"
  TIMESTAMP=$(date +%H:%M:%S)
  ISO_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  PLATFORM_ROOT="${AGENT_PLATFORM_ROOT:-$HOME/.agent-platform}"
  TELEMETRY_DIR="$PLATFORM_ROOT/telemetry"

  echo "${TIMESTAMP} ${SKILL_NAME}" >> "$SKILLS_FILE"
  mkdir -p "$TELEMETRY_DIR"
  printf '{"timestamp":"%s","session_id":"%s","skill":"%s"}\n' "$ISO_TIMESTAMP" "$SESSION_ID" "$SKILL_NAME" >> "$TELEMETRY_DIR/skill-usage.ndjson"
  echo "Skill invoked: $SKILL_NAME"

  # Mark vault-context as loaded for vault gates and edit gates.
  if [ "$SKILL_NAME" = "vault-context" ] || [ "$SKILL_NAME" = "vault-capture" ]; then
    touch "/tmp/claude-vault-context-${SESSION_ID}"
  fi

  # Mark plan as approved for require-plan-before-edits.sh gate.
  if echo "$SKILL_NAME" | grep -qE '^enterprise(-plan|-contract|-build|-forge|-debug|-review|-verify|-discover|-brainstorm|-compound|-harness|-stack-review)?$'; then
    touch "/tmp/claude-plan-approved-${SESSION_ID}"
  fi
fi
