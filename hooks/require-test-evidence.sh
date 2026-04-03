#!/bin/bash
# PreToolUse:Bash — BLOCK commits without fresh test evidence
# Baseline-aware: compares current failures against .claude/test-baseline.json.
# Only blocks if NEW failures appear (regressions). Known failures are allowed.
# Exit 2 = BLOCKED.

EVIDENCE_FILE="$CLAUDE_PROJECT_DIR/.claude/evidence/last-test-run.json"
BASELINE_FILE="$CLAUDE_PROJECT_DIR/.claude/test-baseline.json"

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
  echo "Run tests first: cd apps/api && npx jest" >&2
  echo "Proof-or-STFU: no evidence JSON = no commit." >&2
  exit 2
fi

# Verify evidence quality
CURRENT_COMMIT=$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")

RESULT=$(python3 - "$EVIDENCE_FILE" "$CURRENT_COMMIT" "$CLAUDE_PROJECT_DIR" "$BASELINE_FILE" << 'PYEOF'
import json, sys, subprocess, os, re, hashlib, hmac
from datetime import datetime, timezone

evidence_file, current_commit, project_dir, baseline_file = sys.argv[1:5]

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
ev_tier = ev.get('tier', 'unknown')

# Tier hierarchy: mocked < integration < e2e
MIN_TEST_TIER = 'integration'
TIER_ORDER = {'mocked': 0, 'unknown': 0, 'integration': 1, 'e2e': 2}

# --- HMAC integrity verification ---
EVIDENCE_SALT = b'claude-hook-integrity-v1'
output_tail = ev.get('output_tail', '')
stored_sig = ev.get('_integrity', '')

errors = []

# Verify HMAC signature — blocks hand-written evidence files
if not stored_sig:
    errors.append('Evidence file has no _integrity signature.')
else:
    sig_payload = f"{output_tail}|{ev_commit}|{ev.get('session_id','')}|{exit_code}|{suites_passed}|{ev.get('result',{}).get('tests_passed',0)}".encode()
    expected_sig = hmac.new(EVIDENCE_SALT, sig_payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(stored_sig, expected_sig):
        errors.append('Evidence _integrity signature is INVALID.')

# Verify output_tail contains real test framework output
if not output_tail or len(output_tail.strip()) < 50:
    errors.append('Evidence output_tail is empty or too short.')
else:
    has_test_output = any(pattern in output_tail for pattern in [
        'Test Suites:', 'Test Files', 'Tests:', 'passed', 'failed',
        'PASS', 'FAIL', 'RUN', 'vitest', 'jest'
    ])
    if not has_test_output:
        errors.append('Evidence output_tail does not contain recognizable test framework output.')

if stale:
    errors.append('Evidence is STALE (git state changed since last test run)')

# --- Baseline-aware regression detection ---
# Load known failures from baseline file
known_failures = set()
has_baseline = False
if os.path.exists(baseline_file):
    try:
        with open(baseline_file) as f:
            bl = json.load(f)
        known_failures = set(bl.get('known_failures', []))
        has_baseline = True
    except (json.JSONDecodeError, OSError):
        pass

# Extract current failing suite paths from evidence output
current_failures = set()
for line in output_tail.split('\n'):
    clean = re.sub(r'\x1b\[[0-9;]*m', '', line)
    if clean.strip().startswith('FAIL '):
        path = clean.strip()[5:].strip().split(' ')[0]
        current_failures.add(path)

if has_baseline:
    # Baseline exists — only block on NEW failures not in baseline
    new_failures = current_failures - known_failures
    if new_failures:
        sample = ', '.join(sorted(new_failures)[:5])
        errors.append(f'REGRESSION: {len(new_failures)} new failure(s) not in baseline: {sample}')
else:
    # No baseline — fall back to hardcoded threshold
    KNOWN_FAILURE_BASELINE = 3
    if tests_failed > KNOWN_FAILURE_BASELINE:
        errors.append(f'Tests have {tests_failed} failure(s) beyond baseline of {KNOWN_FAILURE_BASELINE}. Create .claude/test-baseline.json for baseline-aware mode.')

if ev_commit != current_commit:
    errors.append(f'Evidence is for commit {ev_commit}, but HEAD is {current_commit}')

# Minimum suites: project-level override via .claude/evidence/config.json, else 30
MIN_SUITES = 30
config_path = os.path.join(project_dir, '.claude', 'evidence', 'config.json')
if os.path.isfile(config_path):
    try:
        with open(config_path) as cf:
            config = json.load(cf)
        MIN_SUITES = config.get('min_suites', MIN_SUITES)
    except Exception:
        pass
if suites_passed < MIN_SUITES:
    errors.append(f'Only {suites_passed} suites ran. Minimum {MIN_SUITES} required.')

# Enforce minimum test tier
if MIN_TEST_TIER in TIER_ORDER:
    ev_tier_level = TIER_ORDER.get(ev_tier, 0)
    min_tier_level = TIER_ORDER[MIN_TEST_TIER]
    if ev_tier_level < min_tier_level:
        tier_cmds = {
            'integration': 'npm run test:local',
            'e2e': 'npx playwright test'
        }
        fix_cmd = tier_cmds.get(MIN_TEST_TIER, 'the appropriate test command')
        errors.append(f'Test tier "{ev_tier}" below minimum "{MIN_TEST_TIER}". Run: {fix_cmd}.')

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
                        errors.append('Source files modified after test run. Re-run tests.')
                        break
    except (ValueError, OSError):
        pass

if not counts_verified and exit_code == 0:
    print('WARNING: Test counts could not be parsed from output', file=sys.stderr)

if errors:
    print('FAIL|' + '; '.join(errors))
else:
    fixed = known_failures - current_failures
    tests = ev.get('result', {}).get('tests_passed', 0)
    msg = f'{suites_passed} suites passed, {failed} known failures, 0 regressions [tier={ev_tier}]'
    if fixed:
        msg += f' (+{len(fixed)} fixed!)'
    print(f'PASS|{msg}')
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
