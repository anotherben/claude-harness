#!/bin/bash
# PreToolUse:Edit|Write — BLOCK source file edits without vault context
# Ensures work is tracked in Obsidian before any code changes begin.
# Subagents auto-consume vault passes created by pre-agent-dispatch.sh.
# Exit 2 = BLOCKED. No bypass.

HOOK_TMP=$(mktemp /tmp/claude-hook-XXXXXX)
cat > "$HOOK_TMP"
trap "rm -f '$HOOK_TMP'" EXIT

SESSION_ID=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

FILE=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('tool_input',{}).get('file_path',''))" 2>/dev/null)
if [ -z "$FILE" ]; then exit 0; fi

# Only gate source files
if ! echo "$FILE" | grep -qE '\.(js|jsx|ts|tsx)$'; then
  exit 0
fi

# Skip infra files — hooks, skills, plans, evidence, config
if echo "$FILE" | grep -qE '\.claude/(hooks|skills|plans|evidence|worktrees|enterprise-state)/'; then
  exit 0
fi

# Check 1: session-level vault-context marker (parent or already-bootstrapped subagent)
MARKER="/tmp/claude-vault-context-${SESSION_ID}"
if [ -f "$MARKER" ]; then
  exit 0
fi

# Check 2: consume a vault pass from parent dispatch (subagent bootstrap)
PASS_DIR="$CLAUDE_PROJECT_DIR/.claude/evidence/vault-passes"
if [ -d "$PASS_DIR" ]; then
  CLAIMED=$(python3 - "$PASS_DIR" "$SESSION_ID" << 'PYEOF'
import json, sys, os, glob
from datetime import datetime, timezone

pass_dir, session_id = sys.argv[1:3]
now = datetime.now(timezone.utc)

# Find oldest unclaimed, non-expired pass
candidates = []
for path in sorted(glob.glob(os.path.join(pass_dir, "*.json"))):
    try:
        with open(path) as f:
            p = json.load(f)
    except (json.JSONDecodeError, OSError):
        continue

    if p.get("claimed_by") is not None:
        continue

    expires = p.get("expires", "")
    try:
        exp_time = datetime.strptime(expires, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        if exp_time < now:
            # Expired — clean up
            os.remove(path)
            continue
    except (ValueError, TypeError):
        continue

    candidates.append((path, p))

if not candidates:
    print("NONE")
    sys.exit(0)

# Claim the oldest unclaimed pass
path, p = candidates[0]
p["claimed_by"] = session_id
p["claimed_at"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")

with open(path, "w") as f:
    json.dump(p, f, indent=2)
    f.write("\n")

# Output pass data for marker creation
plan = "true" if p.get("plan_approved") else "false"
print(f"CLAIMED|{p['id']}|{p.get('parent_session','')}|{plan}")
PYEOF
  )

  if echo "$CLAIMED" | grep -q "^CLAIMED|"; then
    PASS_ID=$(echo "$CLAIMED" | cut -d'|' -f2)
    PARENT=$(echo "$CLAIMED" | cut -d'|' -f3)
    PLAN=$(echo "$CLAIMED" | cut -d'|' -f4)

    # Set vault-context marker for this session (unlocks all subsequent edits)
    touch "$MARKER"

    # Inherit plan approval from parent if it was approved
    if [ "$PLAN" = "true" ]; then
      touch "/tmp/claude-plan-approved-${SESSION_ID}"
    fi

    echo "Vault pass ${PASS_ID} consumed from parent session ${PARENT}. Vault context inherited."
    exit 0
  fi
fi

echo "BLOCKED: No vault context loaded." >&2
echo "If you are a dispatched subagent: your parent must have vault context before dispatching." >&2
echo "If you are the main session: run /vault-context or /vault-capture before editing source files." >&2
echo "Every code change must be backed by a vault item." >&2
exit 2
