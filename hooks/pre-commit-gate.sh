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
import json, sys, hashlib, hmac
evidence_file = sys.argv[1]
with open(evidence_file) as f:
    ev = json.load(f)
stale = ev.get('stale', True)
tests_failed = ev.get('result', {}).get('tests_failed', 0)
suites_passed = ev.get('result', {}).get('suites_passed', 0)

# Verify HMAC integrity — reject hand-written evidence
EVIDENCE_SALT = b'claude-hook-integrity-v1'
stored_sig = ev.get('_integrity', '')
output_tail = ev.get('output_tail', '')
commit = ev.get('commit', '')
session_id = ev.get('session_id', '')
exit_code = ev.get('result', {}).get('exit_code', -1)
tests_passed_count = ev.get('result', {}).get('tests_passed', 0)

sig_valid = False
if stored_sig:
    sig_payload = f"{output_tail}|{commit}|{session_id}|{exit_code}|{suites_passed}|{tests_passed_count}".encode()
    expected_sig = hmac.new(EVIDENCE_SALT, sig_payload, hashlib.sha256).hexdigest()
    sig_valid = hmac.compare_digest(stored_sig, expected_sig)

if not stored_sig or not sig_valid:
    print('FAIL')
elif stale:
    print('FAIL')
elif tests_failed > 3:  # baseline: 3 known pre-existing failures
    print('FAIL')
else:
    import os, pathlib
    min_suites = 30
    config_path = os.path.join(os.environ.get('CLAUDE_PROJECT_DIR', '.'), '.claude', 'evidence', 'config.json')
    if pathlib.Path(config_path).exists():
        with open(config_path) as cf:
            min_suites = json.load(cf).get('min_suites', 30)
    if suites_passed < min_suites:
        print('FAIL')
    else:
        print('PASS')
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
