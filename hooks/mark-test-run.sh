#!/bin/bash
# PostToolUse hook — marks that tests were run
# Fires after Bash commands that match test runners
# Writes timestamp to /tmp/claude-test-ran-${SESSION_ID} (read by require-tdd-before-source-edit.sh)

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null)

# Claude Code PostToolUse sends tool_response (not tool_output).
# For Bash, tool_response contains the output string; exit code is in tool_response.exit_code
# or inferred from error state. Accept either path; default to 0 (success) if absent.
EXIT_CODE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); tr=d.get('tool_response',{}); to=d.get('tool_output',{}); ec=(tr if isinstance(tr,dict) else {}).get('exit_code',(to if isinstance(to,dict) else {}).get('exit_code',0)); print(ec)" 2>/dev/null || echo 0)

# Detect test runner commands
if echo "$COMMAND" | grep -qE '(npx jest|npm test|npx playwright|vitest)'; then
  # Only mark as run if tests passed (exit code 0)
  if [ "$EXIT_CODE" = "0" ]; then
    date +%s > "/tmp/claude-test-ran-${SESSION_ID}"
  fi
fi

exit 0
