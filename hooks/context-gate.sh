#!/bin/bash
# PreToolUse hook — BLOCKS tool calls when context >= 70%.
# Allows: Muninn saves, handoff doc writes, git commits, MEMORY.md updates, reads.
# Blocks: all other Edit/Write/MultiEdit/Bash calls.
# Exit 2 = block. Exit 0 = allow.

# --- Read tool input ---
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)
TOOL_INPUT=$(echo "$INPUT" | python3 -c "
import sys,json
d = json.load(sys.stdin).get('tool_input',{})
print(d.get('file_path','') or d.get('command',''))
" 2>/dev/null)

# --- Get context percentage ---
# Method 1: actual tokens from transcript
PERCENT=""
if [ -n "$CLAUDE_TRANSCRIPT_PATH" ] && [ -f "$CLAUDE_TRANSCRIPT_PATH" ]; then
  PERCENT=$(tail -30 "$CLAUDE_TRANSCRIPT_PATH" 2>/dev/null | python3 -c "
import sys, json
for line in reversed(sys.stdin.readlines()):
    try:
        d = json.loads(line.strip())
        if d.get('type') == 'assistant':
            u = d.get('message', {}).get('usage', {})
            total = u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0) + u.get('cache_creation_input_tokens', 0)
            if total > 0:
                print(int(min(100, (total / 200000) * 100)))
                break
    except: pass
" 2>/dev/null)
fi

# Method 2: fall back to tool call counter
if [ -z "$PERCENT" ] || [ "$PERCENT" -eq 0 ] 2>/dev/null; then
  COUNTER_FILE="/tmp/claude-fade-${SESSION_ID}"
  if [ -f "$COUNTER_FILE" ]; then
    COUNT=$(cat "$COUNTER_FILE")
    PERCENT=$((COUNT / 2))
  else
    PERCENT=0
  fi
fi

# --- Under 70%: allow everything ---
if [ "$PERCENT" -lt 70 ]; then
  exit 0
fi

# --- 70%+ : gate logic ---

# Always allow Muninn MCP tools (they pass through as tool_name)
case "$TOOL_NAME" in
  mcp__muninn__*) exit 0 ;;
esac

# Allow writing handoff docs and MEMORY.md
case "$TOOL_INPUT" in
  *docs/handovers/*) exit 0 ;;
  *MEMORY.md*) exit 0 ;;
  *memory/MEMORY.md*) exit 0 ;;
  *.claude/plans/*handoff*) exit 0 ;;
esac

# Allow git add, commit, status, diff, log, push (wrapping up)
case "$TOOL_INPUT" in
  git\ add*|git\ commit*|git\ status*|git\ diff*|git\ log*|git\ push*|git\ stash*) exit 0 ;;
esac

# Block everything else
if [ "$PERCENT" -ge 90 ]; then
  echo "BLOCKED: Context at ${PERCENT}% — CRITICAL. Save state to Muninn and handoff NOW. Only Muninn saves, handoff docs, MEMORY.md updates, and git commits are allowed."
  exit 2
else
  echo "BLOCKED: Context at ${PERCENT}% — over 70% threshold. Save state to Muninn before continuing. Allowed: Muninn saves, handoff docs (docs/handovers/), MEMORY.md, git commits."
  exit 2
fi
