#!/bin/bash
# PostToolUse hook — records skill invocations for session tracking.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi
SKILL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('skill','') or d.get('name',''))" 2>/dev/null)

if [ -n "$SKILL_NAME" ]; then
  SKILLS_FILE="/tmp/claude-skills-invoked-${SESSION_ID}"
  TIMESTAMP=$(date +%H:%M:%S)
  ISO_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "$TIMESTAMP $SKILL_NAME" >> "$SKILLS_FILE"
  echo "Skill invoked: $SKILL_NAME"

  PLATFORM_ROOT="${AGENT_PLATFORM_ROOT:-$HOME/.agent-platform}"
  TELEMETRY_DIR="$PLATFORM_ROOT/telemetry"
  mkdir -p "$TELEMETRY_DIR"
  printf '{"timestamp":"%s","session_id":"%s","skill":"%s"}\n' "$ISO_TIMESTAMP" "$SESSION_ID" "$SKILL_NAME" >> "$TELEMETRY_DIR/skill-usage.ndjson"

  # --- HMAC-signed markers ---
  # Prevents agents from creating fake marker files via touch/echo.
  # Salt must match the verification hooks.
  HOOK_SALT="claude-hook-integrity-v1"

  # Mark vault-context as loaded for enforce-vault-context.sh and require-vault-for-edits.sh gates
  if [ "$SKILL_NAME" = "vault-context" ] || [ "$SKILL_NAME" = "vault-capture" ] || [ "$SKILL_NAME" = "brain-dump" ] || [ "$SKILL_NAME" = "park" ] || [ "$SKILL_NAME" = "morning-briefing" ]; then
    SIG=$(echo -n "vault-context|${SESSION_ID}|${HOOK_SALT}" | shasum -a 256 | cut -d' ' -f1)
    echo "${SIG}" > "/tmp/claude-vault-context-${SESSION_ID}"
  fi

  # Mark vault-update invoked for require-vault-update.sh gate
  if [ "$SKILL_NAME" = "vault-update" ] || [ "$SKILL_NAME" = "vault-capture" ]; then
    SIG=$(echo -n "vault-update|${SESSION_ID}|${HOOK_SALT}" | shasum -a 256 | cut -d' ' -f1)
    echo "${SIG}" > "/tmp/claude-vault-update-${SESSION_ID}"
  fi

  # Mark plan as approved for require-plan-before-edits.sh gate
  # All enterprise pipeline stages need edit access — not just planning stages
  if echo "$SKILL_NAME" | grep -qE '^enterprise(-plan|-contract|-build|-forge|-debug|-review|-verify|-discover|-brainstorm|-compound|-harness|-stack-review)?$'; then
    SIG=$(echo -n "plan-approved|${SESSION_ID}|${HOOK_SALT}" | shasum -a 256 | cut -d' ' -f1)
    echo "${SIG}" > "/tmp/claude-plan-approved-${SESSION_ID}"
  fi
fi
