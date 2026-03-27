#!/bin/bash
# PreToolUse:Read|Grep hook — ENFORCES cortex-engine for source file reads.
# Blocks Read on source files >50 lines. Forces agents to use cortex-engine MCP.
# Only allows Read when file is small or non-source (configs, tests, docs, etc).
# Subagents cannot call MCP — orchestrator must pre-feed cortex data in the prompt.

HOOK_INPUT=$(cat)
TOOL_NAME=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)
FILE_PATH=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('file_path','') or d.get('path',''))" 2>/dev/null)
PLATFORM_ROOT="${AGENT_PLATFORM_ROOT:-$HOME/.agent-platform}"
POLICIES_FILE="$PLATFORM_ROOT/compiled/policies.json"
TELEMETRY_DIR="$PLATFORM_ROOT/telemetry"

if [ -f "$POLICIES_FILE" ]; then
  POLICY_VALUES=$(python3 - "$POLICIES_FILE" <<'PYEOF'
import json, sys

with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    retrieval = json.load(handle).get('retrieval', {})

max_lines = retrieval.get('direct_read_max_lines', 50)
tight_limit = retrieval.get('tight_read_limit_max', 80)
print(f"{max_lines}|{tight_limit}")
PYEOF
  )
  MAX_LINES="${POLICY_VALUES%%|*}"
  TIGHT_LIMIT="${POLICY_VALUES##*|}"
else
  MAX_LINES=50
  TIGHT_LIMIT=80
fi

# Allow non-source files through
case "$FILE_PATH" in
  *.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx) exit 0 ;;
  *__tests__/*) exit 0 ;;
  *.json|*.md|*.sql|*.sh|*.css|*.html|*.env*|*.yml|*.yaml|*.toml) exit 0 ;;
  *.png|*.jpg|*.svg|*.gif|*.pdf) exit 0 ;;
  *node_modules*) exit 0 ;;
  *.js|*.jsx|*.ts|*.tsx) ;; # source files — enforce cortex-engine
  *) exit 0 ;;
esac

# Allow if file doesn't exist (agent will get an error anyway)
[ ! -f "$FILE_PATH" ] && exit 0

# Allow small files (<50 lines) — not worth the cortex-engine overhead
LINES=$(wc -l < "$FILE_PATH" 2>/dev/null)
if [ "$LINES" -le "$MAX_LINES" ] 2>/dev/null; then
  exit 0
fi

# Allow targeted reads (offset = editing a known section)
HAS_OFFSET=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print('yes' if d.get('offset') else 'no')" 2>/dev/null)
if [ "$HAS_OFFSET" = "yes" ]; then
  exit 0
fi

# Allow reads with tight limit (reading a known small section for edit context)
HAS_LIMIT=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); lim=d.get('limit',0); max_lim=int(sys.argv[1]); print('yes' if lim and int(lim) <= max_lim else 'no')" "$TIGHT_LIMIT" 2>/dev/null)
if [ "$HAS_LIMIT" = "yes" ]; then
  exit 0
fi

# BLOCK: force cortex-engine for full source file reads
mkdir -p "$TELEMETRY_DIR"
printf '{"timestamp":"%s","file_path":"%s","lines":%s,"blocked":true}\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$FILE_PATH" "$LINES" >> "$TELEMETRY_DIR/read-gate.ndjson"
echo "BLOCKED: Use cortex-engine instead of Read for source files (${LINES} lines)." >&2
echo "" >&2
echo "  Orchestrator (has MCP):" >&2
echo "    cortex_outline(file_path=\"...\")       — list all symbols" >&2
echo "    cortex_read_symbol(file_path, name)   — read one function" >&2
echo "    cortex_read_symbols(specs=[...])       — batch read" >&2
echo "    cortex_context(file_path, name)        — symbol + imports" >&2
echo "    cortex_find_symbol(query=\"...\")        — search by name" >&2
echo "" >&2
echo "  Subagent (no MCP):" >&2
echo "    Orchestrator must pre-read via cortex and paste source into the agent prompt." >&2
echo "    Subagents CANNOT call cortex — feed them the data they need upfront." >&2
echo "" >&2
echo "  Escape hatches:" >&2
echo "    Read with offset=N          — targeted section for editing" >&2
echo "    Read with limit<=${TIGHT_LIMIT}         — small known section" >&2
echo "" >&2
echo "  Stale index? Run: cortex_reindex()" >&2
exit 2
