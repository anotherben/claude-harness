#!/bin/bash
# PostToolUse:Agent — governance checklist after subagent returns
# When an Agent completes, check if a vault pass was consumed (dispatch manifest).
# If so, print the governance checklist the orchestrator MUST complete.
# This is a reminder (exit 0), not a blocker — commit hooks enforce the real gates.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
AGENT_DESC=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('description','unknown'))" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then exit 0; fi

# Check if any vault pass was created by this session (parent dispatched an agent)
PASS_DIR="$CLAUDE_PROJECT_DIR/.claude/evidence/vault-passes"
if [ ! -d "$PASS_DIR" ]; then exit 0; fi

FOUND_PASS=""
for pass_file in "$PASS_DIR"/*.json; do
  [ -f "$pass_file" ] || continue
  PARENT=$(python3 -c "import sys,json; print(json.load(open('$pass_file')).get('parent_session',''))" 2>/dev/null)
  if [ "$PARENT" = "$SESSION_ID" ]; then
    PASS_ID=$(python3 -c "import sys,json; print(json.load(open('$pass_file')).get('id',''))" 2>/dev/null)
    FOUND_PASS="$PASS_ID"
    break
  fi
done

if [ -z "$FOUND_PASS" ]; then exit 0; fi

echo ""
echo "SUBAGENT RETURNED — Governance checklist:"
echo "  [ ] Review changes: git diff"
echo "  [ ] Run integration tests: npm run test:local"
echo "  [ ] Update vault: /vault-update"
echo "  [ ] Commit with evidence"
echo "Dispatch: ${FOUND_PASS} | Parent: ${SESSION_ID} | Agent: ${AGENT_DESC}"
echo ""

exit 0
