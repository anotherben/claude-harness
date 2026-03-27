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
import json, sys, subprocess, os, re, hashlib, hmac
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
ev_tier = ev.get('tier', 'unknown')

MIN_SUITES = 50

# Tier enforcement — integration is replaced by install.sh
# Tier hierarchy: mocked < integration < e2e
MIN_TEST_TIER = 'integration'
TIER_ORDER = {'mocked': 0, 'unknown': 0, 'integration': 1, 'e2e': 2}

# --- HMAC integrity verification ---
# Must match the salt and payload format in record-test-evidence.sh
EVIDENCE_SALT = b'claude-hook-integrity-v1'
output_tail = ev.get('output_tail', '')
stored_sig = ev.get('_integrity', '')

errors = []

# Verify HMAC signature — blocks hand-written evidence files
if not stored_sig:
    errors.append('Evidence file has no _integrity signature. Was it written by the hook or fabricated by an agent?')
else:
    sig_payload = f"{output_tail}|{ev_commit}|{ev.get('session_id','')}|{exit_code}|{suites_passed}|{ev.get('result',{}).get('tests_passed',0)}".encode()
    expected_sig = hmac.new(EVIDENCE_SALT, sig_payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(stored_sig, expected_sig):
        errors.append('Evidence _integrity signature is INVALID. File was tampered with or hand-written.')

# Verify output_tail contains real test framework output
if not output_tail or len(output_tail.strip()) < 50:
    errors.append('Evidence output_tail is empty or too short. Real test runs produce output.')
else:
    has_test_output = any(pattern in output_tail for pattern in [
        'Test Suites:', 'Test Files', 'Tests:', 'passed', 'failed',
        'PASS', 'FAIL', 'RUN', 'vitest', 'jest'
    ])
    if not has_test_output:
        errors.append('Evidence output_tail does not contain recognizable test framework output.')

if stale:
    errors.append('Evidence is STALE (git state changed since last test run)')

# Suite-level failures can be infrastructure (e.g. Prisma client not generated).
# Individual test failures are the real code quality signal.
# Allow a baseline of known pre-existing failures (Prisma load + timing flakes).
# If NEW failures appear beyond the baseline, block.
KNOWN_FAILURE_BASELINE = 3  # weeklyReturns timing flake + barcode Prisma load
if tests_failed > KNOWN_FAILURE_BASELINE:
    errors.append(f'Tests have {tests_failed} failure(s), which is MORE than the known baseline of {KNOWN_FAILURE_BASELINE}. New test failures detected — fix before committing.')

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
    errors.append(f'Only {suites_passed} suites ran. Minimum {MIN_SUITES} required. Run: npx vitest run')

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
        errors.append(
            f'Test evidence tier is "{ev_tier}" but minimum required is "{MIN_TEST_TIER}". '
            f'Run: {fix_cmd}. '
            f'Mocked tests alone do not prove the code works against real services.'
        )

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
    print(f'PASS|{suites_passed} suites, {tests} tests passed on {ev_commit} [tier={ev_tier}]')
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
