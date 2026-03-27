#!/bin/bash
# PreToolUse:Bash — BLOCK commits without vault update (when source files staged)
# Vault is the single source of truth. No completion claims without vault state matching.
# Exit 2 = BLOCKED. No more soft warnings.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)

# Only check on git commit and git push
if ! echo "$COMMAND" | grep -qE 'git (commit|push)'; then
  exit 0
fi

# No source files staged = pure docs/config commit, skip
STAGED_SRC=$(git -C "$CLAUDE_PROJECT_DIR" diff --cached --name-only 2>/dev/null | grep -E '\.(js|jsx|ts|tsx)$' | grep -vE '(__tests__|\.test\.|\.spec\.|node_modules|\.config\.)' || true)
if [ -z "$STAGED_SRC" ]; then
  exit 0
fi

# --- Subagent detection ---
# A subagent is a session that CLAIMED a vault pass where someone ELSE is the parent.
# If claimed_by == SESSION_ID but parent_session == SESSION_ID, we're the orchestrator, not the subagent.
PASS_DIR="$CLAUDE_PROJECT_DIR/.claude/evidence/vault-passes"
IS_SUBAGENT=false
if [ -d "$PASS_DIR" ] && [ -n "$SESSION_ID" ]; then
  for pass_file in "$PASS_DIR"/*.json; do
    [ -f "$pass_file" ] || continue
    PASS_DATA=$(python3 -c "import sys,json; d=json.load(open('$pass_file')); print(d.get('claimed_by','') or '', d.get('parent_session','') or '')" 2>/dev/null)
    CLAIMED_BY=$(echo "$PASS_DATA" | awk '{print $1}')
    PARENT_SESSION=$(echo "$PASS_DATA" | awk '{print $2}')
    if [ "$CLAIMED_BY" = "$SESSION_ID" ] && [ "$PARENT_SESSION" != "$SESSION_ID" ]; then
      IS_SUBAGENT=true
      break
    fi
  done
fi

if [ "$IS_SUBAGENT" = true ]; then
  echo "BLOCKED: Subagent sessions cannot commit directly." >&2
  echo "Return your changes to the orchestrator, who will:" >&2
  echo "  1. Review the diff" >&2
  echo "  2. Run integration tests (npm run test:local)" >&2
  echo "  3. Update vault (/vault-update)" >&2
  echo "  4. Commit" >&2
  exit 2
fi

# Check if vault-update or vault-capture was invoked — via HMAC-signed marker
# The marker is written by mark-skill-invoked.sh (PostToolUse:Skill hook).
# Agents cannot create valid markers without knowing the salt AND being invoked
# through the actual Skill tool.
HOOK_SALT="claude-hook-integrity-v1"
VAULT_MARKER="/tmp/claude-vault-update-${SESSION_ID}"
VAULT_UPDATED=false

if [ -f "$VAULT_MARKER" ]; then
  STORED_SIG=$(cat "$VAULT_MARKER" 2>/dev/null | tr -d '[:space:]')
  EXPECTED_SIG=$(echo -n "vault-update|${SESSION_ID}|${HOOK_SALT}" | shasum -a 256 | cut -d' ' -f1)
  if [ "$STORED_SIG" = "$EXPECTED_SIG" ]; then
    VAULT_UPDATED=true
  else
    echo "BLOCKED: Vault update marker has INVALID signature." >&2
    echo "The marker file was tampered with or hand-written by an agent." >&2
    echo "Run /vault-update or /vault-capture through the Skill tool." >&2
    exit 2
  fi
fi

if [ "$VAULT_UPDATED" = false ]; then
  echo "BLOCKED: Vault not updated in this session." >&2
  echo "Source files are staged — vault must reflect the change." >&2
  echo "Run /vault-update or /vault-capture before committing." >&2
  echo "Vault is the source of truth for project state." >&2
  exit 2
fi

exit 0
