#!/bin/bash
# PostToolUse:Bash — record JSON test evidence to local file + Obsidian vault
# Writes structured evidence to .claude/evidence/last-test-run.json (local, hooks read this)
# AND to {{VAULT_EVIDENCE_PATH}}/{{PROJECT_NAME}}-test-evidence.md (shared, vault-index reads this)
# Stale-marking is handled exclusively by invalidate-after-git-op.sh.

EVIDENCE_DIR="$CLAUDE_PROJECT_DIR/.claude/evidence"
EVIDENCE_FILE="$EVIDENCE_DIR/last-test-run.json"

# Save stdin to temp file (needed for multiple reads by python)
HOOK_TMP=$(mktemp /tmp/claude-hook-XXXXXX)
cat > "$HOOK_TMP"
trap "rm -f '$HOOK_TMP'" EXIT

SESSION_ID=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

COMMAND=$(python3 -c "import json; print(json.load(open('$HOOK_TMP')).get('tool_input',{}).get('command',''))" 2>/dev/null)

# --- Record evidence when test commands run ---
if echo "$COMMAND" | grep -qE '(npx jest|npm run test|npm test|npx playwright|node_modules/\.bin/jest|^\s*jest\s)'; then
  mkdir -p "$EVIDENCE_DIR"
  COMMIT=$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  BRANCH=$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

  python3 - "$HOOK_TMP" "$EVIDENCE_FILE" "$COMMIT" "$BRANCH" "$SESSION_ID" << 'PYEOF'
import json, re, sys, os
from datetime import datetime, timezone

hook_file, evidence_file, commit, branch, session_id = sys.argv[1:6]

with open(hook_file) as f:
    d = json.load(f)

cmd = d.get('tool_input', {}).get('command', '')
tr = d.get('tool_response', '')

# Extract exit code and response text from tool_response
if isinstance(tr, dict):
    exit_code = int(tr.get('exit_code', 0))
    response_text = tr.get('stdout', '') or str(tr)
else:
    exit_code = 0
    response_text = str(tr)

# Determine test mode
mode = 'parallel'
if 'runInBand' in cmd or 'test:local' in cmd:
    mode = 'runInBand'

# Parse jest output for suite/test counts
# Format: "Test Suites:  2 failed, 426 passed, 13 skipped, 441 total"
# Format: "Tests:        3 failed, 4715 passed, 4718 total"
suites_passed = suites_failed = suites_skipped = 0
tests_passed = tests_failed = 0

suite_match = re.search(r'Test Suites:\s+(.+)', response_text)
if suite_match:
    line = suite_match.group(1)
    m = re.search(r'(\d+) failed', line)
    if m: suites_failed = int(m.group(1))
    m = re.search(r'(\d+) passed', line)
    if m: suites_passed = int(m.group(1))
    m = re.search(r'(\d+) skipped', line)
    if m: suites_skipped = int(m.group(1))

test_match = re.search(r'Tests:\s+(.+)', response_text)
if test_match:
    line = test_match.group(1)
    m = re.search(r'(\d+) failed', line)
    if m: tests_failed = int(m.group(1))
    m = re.search(r'(\d+) passed', line)
    if m: tests_passed = int(m.group(1))

# Determine if counts were actually parsed from output
counts_verified = bool(suite_match)

timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

evidence = {
    'type': 'test-run',
    'timestamp': timestamp,
    'commit': commit,
    'branch': branch,
    'command': cmd,
    'mode': mode,
    'result': {
        'suites_passed': suites_passed,
        'suites_failed': suites_failed,
        'suites_skipped': suites_skipped,
        'tests_passed': tests_passed,
        'tests_failed': tests_failed,
        'exit_code': exit_code
    },
    'session_id': session_id,
    'stale': False,
    'counts_verified': counts_verified
}

# --- Write local JSON (hooks read this) ---
os.makedirs(os.path.dirname(evidence_file), exist_ok=True)
with open(evidence_file, 'w') as f:
    json.dump(evidence, f, indent=2)
    f.write('\n')

# --- Detect project from CLAUDE_PROJECT_DIR ---
project_dir = os.environ.get('CLAUDE_PROJECT_DIR', '')
project_name = os.path.basename(project_dir) if project_dir else '{{PROJECT_NAME}}'

# --- Write Obsidian vault note (cross-agent visibility) ---
vault_path = os.path.expanduser('{{VAULT_PATH}}')
evidence_dir_vault = os.path.join(vault_path, '_evidence')
if os.path.isdir(vault_path):
    os.makedirs(evidence_dir_vault, exist_ok=True)
    vault_note_path = os.path.join(evidence_dir_vault, f'{project_name}-test-evidence.md')

    if suites_failed == 0 and tests_failed == 0 and exit_code == 0:
        ev_status = 'green'
    else:
        ev_status = 'red'

    vault_note = f"""---
id: evidence_{project_name}_test_run
type: evidence
project: {project_name}
module: verification
status: {ev_status}
priority: low
branch: {branch}
created: {timestamp}
updated: {timestamp}
tags:
  - test-evidence
  - automated
  - {mode}
---

# Test Evidence: {project_name}

| Field | Value |
|-------|-------|
| Commit | `{commit}` |
| Branch | `{branch}` |
| Mode | {mode} |
| Command | `{cmd}` |
| Timestamp | {timestamp} |
| Session | `{session_id}` |
| Counts verified | {counts_verified} |

## Results

- **Suites:** {suites_passed} passed, {suites_failed} failed, {suites_skipped} skipped
- **Tests:** {tests_passed} passed, {tests_failed} failed
- **Exit code:** {exit_code}
- **Status:** {'GREEN' if ev_status == 'green' else 'RED'}
- **Stale:** False
"""

    with open(vault_note_path, 'w') as f:
        f.write(vault_note)

    # Touch reindex marker so agents know vault needs reindex
    marker = os.path.join(evidence_dir_vault, '.needs-reindex')
    with open(marker, 'w') as f:
        f.write(timestamp)
PYEOF
fi

exit 0
