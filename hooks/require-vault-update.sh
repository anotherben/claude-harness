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
