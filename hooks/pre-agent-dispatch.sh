#!/bin/bash
# PreToolUse:Agent — create vault pass so subagents inherit parent authorization
# When the parent dispatches a subagent, this hook writes a vault pass file
# that the subagent auto-consumes on first edit via require-vault-for-edits.sh.
# Each Agent invocation = one pass = one subagent. Passes expire after 2 hours.
# Exit 0 always — dispatch is never blocked, but subagent will be blocked
# if parent had no vault context (no pass created).

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

# Check if parent has vault context
PARENT_VAULT_MARKER="/tmp/claude-vault-context-${SESSION_ID}"

# Stale marker check: marker must be less than 2 hours old
if [ -f "$MARKER" ]; then
  MARKER_AGE=$(( $(date +%s) - $(stat -f %m "$MARKER" 2>/dev/null || stat -c %Y "$MARKER" 2>/dev/null || echo 0) ))
  if [ "$MARKER_AGE" -gt 7200 ]; then
    rm -f "$MARKER"  # Stale marker — remove it
  fi
fi
if [ ! -f "$PARENT_VAULT_MARKER" ]; then
  echo "WARNING: Dispatching agent without vault context. Subagent will be blocked from editing source files." >&2
  echo "Run /vault-context or /vault-capture first, then dispatch." >&2
  exit 0
fi

PASS_DIR="$CLAUDE_PROJECT_DIR/.claude/evidence/vault-passes"
mkdir -p "$PASS_DIR"

# Check parent plan approval state
PLAN_APPROVED=false
if [ -f "/tmp/claude-plan-approved-${SESSION_ID}" ]; then
  PLAN_APPROVED=true
fi

# Read agent prompt/description from tool_input for audit trail
AGENT_DESC=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('description','') or d.get('prompt','')[:100])" 2>/dev/null)

python3 - "$PASS_DIR" "$SESSION_ID" "$PLAN_APPROVED" "$AGENT_DESC" << 'PYEOF'
import json, sys, os, uuid
from datetime import datetime, timezone, timedelta

pass_dir, parent_session, plan_approved_str, agent_desc = sys.argv[1:5]
plan_approved = plan_approved_str == 'true'

pass_id = f"{int(datetime.now(timezone.utc).timestamp())}-{uuid.uuid4().hex[:8]}"
now = datetime.now(timezone.utc)

pass_data = {
    "id": pass_id,
    "parent_session": parent_session,
    "created": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "expires": (now + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "claimed_by": None,
    "claimed_at": None,
    "plan_approved": plan_approved,
    "agent_description": agent_desc
}

path = os.path.join(pass_dir, f"{pass_id}.json")
with open(path, "w") as f:
    json.dump(pass_data, f, indent=2)
    f.write("\n")

print(f"Vault pass {pass_id} created for subagent dispatch")
PYEOF

exit 0
