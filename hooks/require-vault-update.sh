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
# If this session claimed a vault pass, it's a subagent. Subagents cannot commit.
PASS_DIR="$CLAUDE_PROJECT_DIR/.claude/evidence/vault-passes"
IS_SUBAGENT=false
if [ -d "$PASS_DIR" ] && [ -n "$SESSION_ID" ]; then
  for pass_file in "$PASS_DIR"/*.json; do
    [ -f "$pass_file" ] || continue
    CLAIMED_BY=$(python3 -c "import sys,json; print(json.load(open('$pass_file')).get('claimed_by','') or '')" 2>/dev/null)
    if [ "$CLAIMED_BY" = "$SESSION_ID" ]; then
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

# Check if vault-update or vault-capture was invoked in this session
SKILLS_FILE="/tmp/claude-skills-invoked-${SESSION_ID}"
VAULT_UPDATED=false

if [ -f "$SKILLS_FILE" ]; then
  if grep -qE "vault-update|vault-capture" "$SKILLS_FILE" 2>/dev/null; then
    VAULT_UPDATED=true
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
