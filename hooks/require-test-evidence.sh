#!/bin/bash
# PreToolUse:Bash — BLOCK commits without fresh, passing test evidence
# Reads .claude/evidence/last-test-run.json and verifies:
#   - stale == false
#   - suites_failed == 0
#   - commit matches current HEAD
# Exit 2 = BLOCKED. No more soft warnings.

EVIDENCE_FILE="$CLAUDE_PROJECT_DIR/.claude/evidence/last-test-run.json"

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

# Only check on git commit
if ! echo "$COMMAND" | grep -qE 'git commit'; then
  exit 0
fi

# No source files staged = pure docs/config commit, skip
STAGED_SRC=$(git -C "$CLAUDE_PROJECT_DIR" diff --cached --name-only 2>/dev/null | grep -E '\.(js|jsx|ts|tsx)$' | grep -vE '(__tests__|\.test\.|\.spec\.|node_modules)' || true)
if [ -z "$STAGED_SRC" ]; then
  exit 0
fi

# Check evidence file exists
if [ ! -f "$EVIDENCE_FILE" ]; then
  echo "BLOCKED: No test evidence found at .claude/evidence/last-test-run.json" >&2
  echo "Run tests first: cd apps/api && npm run test:local" >&2
  echo "Proof-or-STFU: no evidence JSON = no commit." >&2
  exit 2
fi

# Verify evidence quality
CURRENT_COMMIT=$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")

RESULT=$(python3 - "$EVIDENCE_FILE" "$CURRENT_COMMIT" "$CLAUDE_PROJECT_DIR" << 'PYEOF'
import json, sys, subprocess, os, re
from datetime import datetime, timezone

evidence_file, current_commit, project_dir = sys.argv[1:4]

with open(evidence_file) as f:
    ev = json.load(f)

stale = ev.get('stale', True)
failed = ev.get('result', {}).get('suites_failed', -1)
tests_failed = ev.get('result', {}).get('tests_failed', -1)
exit_code = ev.get('result', {}).get('exit_code', -1)
ev_commit = ev.get('commit', '')
counts_verified = ev.get('counts_verified', True)
suites_passed = ev.get('result', {}).get('suites_passed', 0)
mode = ev.get('mode', 'parallel')
ev_timestamp = ev.get('timestamp', '')

MIN_SUITES = 50

errors = []
if stale:
    errors.append('Evidence is STALE (git state changed since last test run)')
if failed != 0:
    errors.append(f'Tests have {failed} failed suite(s)')
if tests_failed != 0:
    errors.append(f'Tests have {tests_failed} individual test failure(s)')
if exit_code != 0:
    errors.append(f'Test exit code was {exit_code} (non-zero)')
if ev_commit != current_commit:
    errors.append(f'Evidence is for commit {ev_commit}, but HEAD is {current_commit}')
if suites_passed < MIN_SUITES:
    errors.append(f'Only {suites_passed} suites ran. Full suite required (minimum {MIN_SUITES}). Run: cd apps/api && npm run test:local')
if mode == 'parallel':
    errors.append('Tests ran in parallel mode. RunInBand required for evidence. Run: cd apps/api && npm run test:local')

if ev_timestamp and not stale:
    try:
        ev_time = datetime.strptime(ev_timestamp, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp()
        staged = subprocess.run(
            ['git', '-C', project_dir, 'diff', '--cached', '--name-only'],
            capture_output=True, text=True
        ).stdout.strip().splitlines()
        src_pattern = re.compile(r'\.(js|jsx|ts|tsx)$')
        test_pattern = re.compile(r'(__tests__|\.test\.|\.spec\.)')
        for f_path in staged:
            if src_pattern.search(f_path) and not test_pattern.search(f_path):
                full_path = os.path.join(project_dir, f_path)
                if os.path.exists(full_path):
                    mtime = os.path.getmtime(full_path)
                    if mtime > ev_time:
                        errors.append('Source files modified after test run. Re-run tests on current code.')
                        break
    except (ValueError, OSError):
        pass

if not counts_verified and exit_code == 0:
    print('WARNING: Test counts could not be parsed from output (exit code was 0)', file=sys.stderr)

if errors:
    print('FAIL|' + '; '.join(errors))
else:
    tests = ev.get('result', {}).get('tests_passed', 0)
    print(f'PASS|{suites_passed} suites, {tests} tests passed on {ev_commit}')
PYEOF
)

STATUS=$(echo "$RESULT" | cut -d'|' -f1)
MESSAGE=$(echo "$RESULT" | cut -d'|' -f2-)

if [ "$STATUS" = "FAIL" ]; then
  echo "BLOCKED: $MESSAGE" >&2
  exit 2
fi

echo "Test evidence verified: $MESSAGE"
exit 0
