#!/bin/bash
# PostCompact hook — re-injects active skill context after compaction.
# When context compacts, the active skill invocation can be lost.
# This hook checks what skill was active and reminds the agent to continue it.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
TRIGGER=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('trigger','unknown'))" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then exit 0; fi

# Check skills-invoked file for the active skill
SKILLS_FILE="/tmp/claude-skills-invoked-${SESSION_ID}"
METHODOLOGY_FILE="/tmp/claude-methodology-${SESSION_ID}"

MESSAGE=""

# Check methodology
METHODOLOGY=$(cat "$METHODOLOGY_FILE" 2>/dev/null)
if [ -n "$METHODOLOGY" ]; then
  MESSAGE="Active methodology: $METHODOLOGY. "
fi

# Check active skills
if [ -f "$SKILLS_FILE" ]; then
  ACTIVE_SKILLS=$(cat "$SKILLS_FILE" 2>/dev/null | sort -u | tr '\n' ', ' | sed 's/,$//')
  if [ -n "$ACTIVE_SKILLS" ]; then
    MESSAGE="${MESSAGE}Active skills before compaction: ${ACTIVE_SKILLS}. "
  fi
fi

# Check for enterprise state files in the project
ENTERPRISE_STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/enterprise-state"
if [ -d "$ENTERPRISE_STATE_DIR" ]; then
  # Find most recent active enterprise task
  ACTIVE_TASK=$(find "$ENTERPRISE_STATE_DIR" -name "*.json" -newer /tmp/.claude-compact-marker-${SESSION_ID} 2>/dev/null | head -1)
  if [ -n "$ACTIVE_TASK" ]; then
    TASK_SLUG=$(python3 -c "import json; d=json.load(open('$ACTIVE_TASK')); print(d.get('slug','unknown'))" 2>/dev/null)
    TASK_STATUS=$(python3 -c "import json; d=json.load(open('$ACTIVE_TASK')); stages=d.get('stages',{}); [print(f'{k}:{v.get(\"status\",\"?\")}'  ) for k,v in stages.items() if v.get('status') not in ('skip','complete')]" 2>/dev/null | head -3 | tr '\n' ', ')
    if [ -n "$TASK_SLUG" ]; then
      MESSAGE="${MESSAGE}Enterprise task '${TASK_SLUG}' was in progress. Pending stages: ${TASK_STATUS}. "
    fi
  fi
fi

# Check for fleet state
FLEET_FILES=$(find "$ENTERPRISE_STATE_DIR" -name "fleet-*.json" 2>/dev/null | sort -r | head -1)
if [ -n "$FLEET_FILES" ]; then
  FLEET_STATUS=$(python3 -c "import json; d=json.load(open('$FLEET_FILES')); print(f\"Fleet {d.get('fleet_id','?')}: {d.get('status','?')}\")" 2>/dev/null)
  if [ -n "$FLEET_STATUS" ]; then
    MESSAGE="${MESSAGE}${FLEET_STATUS}. "
  fi
fi

if [ -n "$MESSAGE" ]; then
  # Touch marker for next compaction detection
  touch "/tmp/.claude-compact-marker-${SESSION_ID}" 2>/dev/null

  echo "POST-COMPACT CONTEXT RECOVERY:"
  echo "$MESSAGE"
  echo ""
  echo "If a skill pipeline was active, resume it from the current stage."
  echo "If fleet-commander was orchestrating, check agent-deck status."
  echo "Read MEMORY.md and any active contracts/plans to re-establish context."
fi

exit 0
