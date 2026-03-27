#!/bin/bash
# PreToolUse hook — blocks edits to protected files unless a valid elevation code is present.
# Protected: .env, .git/hooks/, .claude/hooks/, .claude/settings.json, .claude/evidence/
#
# Elevation: user runs `claude-unlock` to get a 6-digit code.
# Agent includes ELEVATE=<code> in the file content or a prior message.
# Code is single-use and time-limited (10 min).

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
FILE=""

if [ "$TOOL" = "Edit" ] || [ "$TOOL" = "str_replace" ] || [ "$TOOL" = "Write" ]; then
  FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
fi

if [ -z "$FILE" ]; then
  exit 0
fi

# Determine if file is protected
PROTECTED=false

if echo "$FILE" | grep -qE '(\.env$|\.env\.local$|middleware/auth\.js$)'; then
  PROTECTED=true
fi

if echo "$FILE" | grep -qE '\.git/hooks/'; then
  PROTECTED=true
fi

if echo "$FILE" | grep -qE '/\.claude/hooks/|/\.claude/settings\.json$|/\.claude/evidence/'; then
  PROTECTED=true
fi

if [ "$PROTECTED" = false ]; then
  exit 0
fi

# --- Protected file — check for elevation code ---
ELEVATE_FILE="/tmp/claude-unlock"

if [ ! -f "$ELEVATE_FILE" ]; then
  echo "BLOCKED: $FILE is protected infrastructure." >&2
  echo "To allow this edit, the user must run: claude-unlock" >&2
  echo "Then provide the 6-digit code." >&2
  exit 2
fi

# Read and validate the elevation code
STORED=$(cat "$ELEVATE_FILE" 2>/dev/null)
STORED_CODE=$(echo "$STORED" | cut -d'|' -f1)
STORED_EXPIRY=$(echo "$STORED" | cut -d'|' -f2)
NOW=$(date +%s)

# Check expiry
if [ -n "$STORED_EXPIRY" ] && [ "$NOW" -gt "$STORED_EXPIRY" ]; then
  rm -f "$ELEVATE_FILE"
  echo "BLOCKED: Elevation code has expired. Run claude-unlock again." >&2
  exit 2
fi

# Check if the agent has provided the code
# Look for ELEVATE=XXXXXX in the tool input (new_string for Edit, content for Write)
AGENT_CODE=$(echo "$INPUT" | python3 -c "
import sys, json, re
d = json.load(sys.stdin)
ti = d.get('tool_input', {})
# Check new_string (Edit) or content (Write) for ELEVATE=XXXXXX
text = ti.get('new_string', '') + ti.get('content', '') + ti.get('old_string', '')
m = re.search(r'ELEVATE=(\d{6})', text)
if m:
    print(m.group(1))
else:
    print('')
" 2>/dev/null)

# Also check the tool_input description for the code
if [ -z "$AGENT_CODE" ]; then
  AGENT_CODE=$(echo "$INPUT" | python3 -c "
import sys, json, re
d = json.load(sys.stdin)
# Check description field
desc = d.get('tool_input', {}).get('description', '')
m = re.search(r'ELEVATE=(\d{6})', desc)
if m:
    print(m.group(1))
else:
    print('')
" 2>/dev/null)
fi

if [ -z "$AGENT_CODE" ]; then
  echo "BLOCKED: $FILE is protected. Elevation code required." >&2
  echo "The user has generated a code. Include ELEVATE=<code> in your edit." >&2
  echo "Ask the user for the code if you don't have it." >&2
  exit 2
fi

# Verify code matches
if [ "$AGENT_CODE" = "$STORED_CODE" ]; then
  # Burn the code — single use
  rm -f "$ELEVATE_FILE"
  echo "ELEVATED: Code verified. Write to $FILE allowed (one-time)." >&2
  exit 0
else
  echo "BLOCKED: Invalid elevation code. Ask the user for the correct code." >&2
  exit 2
fi
