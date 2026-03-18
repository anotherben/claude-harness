#!/bin/bash
# PreToolUse:Bash — pre-commit gate reading unified JSON evidence
# Blocks git commit if verification pipeline wasn't followed.
# Reads .claude/evidence/last-test-run.json instead of /tmp markers.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)
EVIDENCE_FILE="$CLAUDE_PROJECT_DIR/.claude/evidence/last-test-run.json"

# Only gate on git commit commands
if ! echo "$COMMAND" | grep -qE 'git commit'; then
  exit 0
fi

# Check for modified source files (staged for commit)
MODIFIED_SRC=$(git -C "$CLAUDE_PROJECT_DIR" diff --cached --name-only 2>/dev/null | grep -E '\.(js|jsx|ts|tsx)$' | grep -vE '(__tests__|\.test\.|\.spec\.|node_modules)' || true)

if [ -z "$MODIFIED_SRC" ]; then
  # No source files being committed, allow
  exit 0
fi

# Count modified source files
SRC_COUNT=$(echo "$MODIFIED_SRC" | wc -l | tr -d ' ')

# Check if any test files are also being committed
MODIFIED_TESTS=$(git -C "$CLAUDE_PROJECT_DIR" diff --cached --name-only 2>/dev/null | grep -E '(\.test\.|\.spec\.|__tests__)' || true)

# Check unified JSON evidence for recent passing test run
RECENT_TEST_RUN=false
if [ -f "$EVIDENCE_FILE" ]; then
  RESULT=$(python3 - "$EVIDENCE_FILE" << 'PYEOF'
import json, sys
evidence_file = sys.argv[1]
with open(evidence_file) as f:
    ev = json.load(f)
stale = ev.get('stale', True)
failed = ev.get('result', {}).get('suites_failed', -1)
if not stale and failed == 0:
    print('PASS')
else:
    print('FAIL')
PYEOF
  )
  if [ "$RESULT" = "PASS" ]; then
    RECENT_TEST_RUN=true
  fi
fi

# GATE: If 3+ source files modified but no test files and no recent passing test run, block
if [ "$SRC_COUNT" -ge 1 ] && [ -z "$MODIFIED_TESTS" ] && [ "$RECENT_TEST_RUN" = false ]; then
  echo "BLOCKED: Committing $SRC_COUNT source file(s) without tests." >&2
  echo "Verification pipeline requires: generate tests -> tests pass -> code review -> commit" >&2
  echo "Either add test files to the commit or run tests first (npx jest)." >&2
  exit 2
fi

# GATE: If source files modified but no test evidence, warn (but allow — require-test-evidence handles the hard block)
if [ "$RECENT_TEST_RUN" = false ] && [ -n "$MODIFIED_SRC" ]; then
  echo "WARNING: No fresh passing test evidence found." >&2
  echo "Run tests before committing: cd apps/api && npm run test:local" >&2
fi

exit 0
