#!/bin/bash
# SessionStart hook — ensures cortex-memory and skills are installed.
# Runs at session start. Fast no-op if everything is already set up.

HOOK_INPUT=$(cat)
SESSION_ID=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then SESSION_ID="unknown"; fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
CHANGED=()

# 1. Install cortex-memory MCP server
if [ ! -d ~/.cortex-memory/node_modules ]; then
  if [ -d "$PROJECT_DIR/.claude/cortex-memory-snapshot" ]; then
    mkdir -p ~/.cortex-memory
    cp -r "$PROJECT_DIR/.claude/cortex-memory-snapshot/"* ~/.cortex-memory/
    cd ~/.cortex-memory && npm install --silent 2>/dev/null
    CHANGED+=("cortex-memory installed")
  fi
fi

# 2. Install utility skills
for skill in run-verification create-migration senior-architect session-heartbeat sql-guard scope-check deploy-checklist handover-writer worktree-cleanup; do
  if [ ! -f ~/.claude/skills/$skill/SKILL.md ] && [ -f "$PROJECT_DIR/.claude/skills/$skill/SKILL.md" ]; then
    mkdir -p ~/.claude/skills/$skill
    cp "$PROJECT_DIR/.claude/skills/$skill/SKILL.md" ~/.claude/skills/$skill/
    CHANGED+=("skill:$skill")
  fi
done

# 3. Check cortex-memory is registered in user settings
if [ -f ~/.claude/settings.json ]; then
  if ! grep -q 'cortex-memory' ~/.claude/settings.json 2>/dev/null; then
    CHANGED+=("WARNING: cortex-memory not in ~/.claude/settings.json mcpServers — add it manually")
  fi
fi

# 4. Check methodology choice
METHODOLOGY_FILE="/tmp/claude-methodology-${SESSION_ID}"
if [ ! -f "$METHODOLOGY_FILE" ]; then
  CHANGED+=("METHODOLOGY NOT SET — ask user: Superpowers or Compound Engineering?")
fi

# Report
if [ ${#CHANGED[@]} -gt 0 ]; then
  echo "Environment setup: ${CHANGED[*]}"
else
  exit 0
fi
