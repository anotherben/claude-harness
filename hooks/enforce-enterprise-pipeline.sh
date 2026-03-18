#!/bin/bash
# PreToolUse:Skill — enforces enterprise pipeline stage ordering.

HOOK_TMP=$(mktemp /tmp/claude-hook-XXXXXX)
cat > "$HOOK_TMP"
trap "rm -f '$HOOK_TMP'" EXIT

SESSION_ID=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

SKILL_NAME=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('tool_input',{}).get('skill',''))" 2>/dev/null)

case "$SKILL_NAME" in
  enterprise-*) ;;
  *) exit 0 ;;
esac

if [ "$SKILL_NAME" = "enterprise-debug" ]; then exit 0; fi

SKILLS_FILE="/tmp/claude-skills-invoked-${SESSION_ID}"
if [ ! -f "$SKILLS_FILE" ]; then
  INVOKED=""
else
  INVOKED=$(cat "$SKILLS_FILE")
fi

has_skill() {
  echo "$INVOKED" | grep -q " $1$"
}

check_prereq() {
  local skill="$1"
  shift
  for prereq in "$@"; do
    if has_skill "$prereq"; then
      return 0
    fi
  done
  echo "BLOCKED: Cannot run $skill without $1. Enterprise pipeline stages must be followed in order." >&2
  exit 2
}

case "$SKILL_NAME" in
  enterprise-brainstorm)  check_prereq "$SKILL_NAME" enterprise-discover enterprise ;;
  enterprise-plan)        check_prereq "$SKILL_NAME" enterprise-brainstorm enterprise ;;
  enterprise-contract)    check_prereq "$SKILL_NAME" enterprise-plan enterprise ;;
  enterprise-build)       check_prereq "$SKILL_NAME" enterprise-contract enterprise ;;
  enterprise-review)      check_prereq "$SKILL_NAME" enterprise-build enterprise ;;
  enterprise-forge)       check_prereq "$SKILL_NAME" enterprise-review enterprise ;;
  enterprise-verify)      check_prereq "$SKILL_NAME" enterprise-build enterprise ;;
  enterprise-compound)    check_prereq "$SKILL_NAME" enterprise-verify enterprise ;;
esac

exit 0
