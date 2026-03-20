#!/bin/bash
# PostToolUse hook — classification outcome logger + misclassification detector
# Tracks skill invocations against classified intent to detect routing errors
#
# Input: JSON on stdin with tool_name, tool_input, tool_result
# Output: nothing (always passes through)

HOOK_INPUT=$(cat)

# Extract tool name
TOOL_NAME=$(echo "$HOOK_INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_name', ''))
except:
    print('')
" 2>/dev/null)

# Only act on Skill invocations — that's where misclassification is detectable
[ "$TOOL_NAME" != "Skill" ] && exit 0

# Extract which skill was invoked
SKILL_NAME=$(echo "$HOOK_INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    inp = d.get('tool_input', {})
    if isinstance(inp, str):
        inp = json.loads(inp)
    print(inp.get('skill', inp.get('name', '')))
except:
    print('')
" 2>/dev/null)

[ -z "$SKILL_NAME" ] && exit 0

# Session state
SESSION_ID="${CLAUDE_SESSION_ID:-$(echo "$$-$(date +%Y%m%d)" | shasum | cut -c1-8)}"
CLASSIFICATION_FILE="/tmp/claude-classification-${SESSION_ID}"
PROJ_DIR="${CLAUDE_PROJECT_DIR:-.}"
KNOWLEDGE_FILE="${PROJ_DIR}/.cortex/knowledge.jsonl"

# Read last classification (written by classify-prompt.sh)
LAST_INTENT=""
if [ -f "$CLASSIFICATION_FILE" ]; then
  LAST_INTENT=$(cat "$CLASSIFICATION_FILE")
fi

# Map skill names to expected intents
expected_intent_for_skill() {
  case "$1" in
    enterprise-debug|b-deep-debug*) echo "bug" ;;
    enterprise|enterprise-build|enterprise-brainstorm|enterprise-plan|enterprise-contract) echo "feature" ;;
    enterprise-review|enterprise-forge|enterprise-verify|enterprise-harness) echo "feature" ;;
    vault-capture) echo "reference" ;;
    deploy-checklist) echo "ops" ;;
    create-migration) echo "ops" ;;
    enterprise-discover|but-why) echo "investigate" ;;
    senior-architect|b-senior-architect) echo "design" ;;
    *) echo "" ;;
  esac
}

EXPECTED=$(expected_intent_for_skill "$SKILL_NAME")

# If we have both a classification and an expected intent, check for mismatch
if [ -n "$LAST_INTENT" ] && [ -n "$EXPECTED" ] && [ "$LAST_INTENT" != "$EXPECTED" ]; then
  # Misclassification detected — user invoked a different skill than we suggested
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

  if [ -d "$(dirname "$KNOWLEDGE_FILE")" ]; then
    printf '{"target":"global","note":"Misclassification: prompt classified as %s but user invoked %s (expected %s intent). Reclassification signal.","author":"prompt-intelligence","tags":["feedback","classification","misclass","lesson"],"timestamp":"%s"}\n' \
      "$LAST_INTENT" \
      "$SKILL_NAME" \
      "$EXPECTED" \
      "$TIMESTAMP" >> "$KNOWLEDGE_FILE"
  fi

  # Track misclassification frequency
  MISCLASS_FILE="/tmp/claude-misclass-${SESSION_ID}"
  MISCLASS_COUNT=1
  if [ -f "$MISCLASS_FILE" ]; then
    MISCLASS_COUNT=$(( $(cat "$MISCLASS_FILE") + 1 ))
  fi
  echo "$MISCLASS_COUNT" > "$MISCLASS_FILE"
fi

# Log classification outcome (for accuracy tracking)
if [ -n "$LAST_INTENT" ]; then
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  LOG_DIR="/tmp/claude-classification-log"
  mkdir -p "$LOG_DIR" 2>/dev/null
  echo "${TIMESTAMP} intent=${LAST_INTENT} skill=${SKILL_NAME} match=$([ "$LAST_INTENT" = "$EXPECTED" ] && echo "yes" || echo "no")" \
    >> "${LOG_DIR}/${SESSION_ID}.log"
fi

# Clear classification after logging (one classification per prompt)
rm -f "$CLASSIFICATION_FILE" 2>/dev/null

exit 0
