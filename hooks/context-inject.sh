#!/bin/bash
# Context injection hook — zero-cost until triggered.
# Detects patterns in Bash commands and injects relevant operational context.
# Reads project-specific config from .claude/context-inject.json if it exists.
# Falls back to knowledge graph queries if no config file.
# Fires on PreToolUse for Bash. Exits 0 (non-blocking) with optional message.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Skip if no command
[ -z "$COMMAND" ] && exit 0

# Load project config if it exists
CONFIG_FILE="$CLAUDE_PROJECT_DIR/.claude/context-inject.json"
if [ -f "$CONFIG_FILE" ]; then
  DEV_DB=$(jq -r '.dev_database_url // empty' "$CONFIG_FILE")
  PROD_DB_PATTERN=$(jq -r '.prod_database_pattern // empty' "$CONFIG_FILE")
  DEV_DEPLOY_ID=$(jq -r '.dev_deploy_id // empty' "$CONFIG_FILE")
  DEV_DEPLOY_URL=$(jq -r '.dev_deploy_url // empty' "$CONFIG_FILE")
  PROTECTED_PORTS=$(jq -r '.protected_ports // [] | .[] | "\(.port):\(.reason)"' "$CONFIG_FILE" 2>/dev/null)
  PROTECTED_BRANCHES=$(jq -r '.protected_branches // ["master","main"] | join("|")' "$CONFIG_FILE")
else
  # No config — use sensible defaults only
  DEV_DB=""
  PROD_DB_PATTERN="production"
  DEV_DEPLOY_ID=""
  DEV_DEPLOY_URL=""
  PROTECTED_PORTS=""
  PROTECTED_BRANCHES="master|main"
fi

# --- Database commands ---
if echo "$COMMAND" | grep -qiE 'psql|pg_dump|pg_restore|DATABASE_URL|createdb|dropdb'; then
  # Check if it's using production (block)
  if [ -n "$PROD_DB_PATTERN" ] && echo "$COMMAND" | grep -qiE "$PROD_DB_PATTERN"; then
    echo "BLOCKED: Command matches production database pattern."
    [ -n "$DEV_DB" ] && echo "Dev DB: $DEV_DB"
    exit 2
  fi
  # Inject dev DB string if configured
  if [ -n "$DEV_DB" ]; then
    echo "Context: Dev DB = $DEV_DB"
  fi
  exit 0
fi

# --- Deploy commands ---
if echo "$COMMAND" | grep -qiE 'render|deploy|srv-|heroku|railway|fly\.io'; then
  if echo "$COMMAND" | grep -qiE 'production|prod'; then
    echo "BLOCKED: Do NOT target production deployment."
    exit 2
  fi
  if [ -n "$DEV_DEPLOY_ID" ]; then
    echo "Context: Dev deploy = $DEV_DEPLOY_ID ($DEV_DEPLOY_URL). NEVER use production."
  fi
  exit 0
fi

# --- Protected ports ---
if [ -n "$PROTECTED_PORTS" ]; then
  while IFS=: read -r port reason; do
    if echo "$COMMAND" | grep -qiE "kill.*$port|port.*$port|fuser.*$port|lsof.*$port"; then
      echo "WARNING: Port $port is protected — $reason"
      exit 0
    fi
  done <<< "$PROTECTED_PORTS"
fi

# --- Protected branches ---
if [ -n "$PROTECTED_BRANCHES" ]; then
  if echo "$COMMAND" | grep -qiE "git push.* ($PROTECTED_BRANCHES)|git push -f"; then
    echo "BLOCKED: Never push to protected branches ($PROTECTED_BRANCHES)."
    exit 2
  fi
fi

# No pattern matched — pass through silently
exit 0
