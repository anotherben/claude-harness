#!/bin/bash
# PostToolUse:Bash — record JSON test evidence to local file + Obsidian vault
# Writes structured evidence to .claude/evidence/last-test-run.json (local, hooks read this)
# AND to {{VAULT_EVIDENCE_PATH}}/{{PROJECT_NAME}}-test-evidence.md (shared, vault-index reads this)
# Stale-marking is handled exclusively by invalidate-after-git-op.sh.

EVIDENCE_DIR="$CLAUDE_PROJECT_DIR/.claude/evidence"
EVIDENCE_FILE="$EVIDENCE_DIR/last-test-run.json"
STACK_PROFILE="$CLAUDE_PROJECT_DIR/.claude/enterprise-state/stack-profile.json"

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

  python3 - "$HOOK_TMP" "$EVIDENCE_FILE" "$COMMIT" "$BRANCH" "$SESSION_ID" "$STACK_PROFILE" << 'PYEOF'
import json, re, sys, os
from datetime import datetime, timezone

hook_file, evidence_file, commit, branch, session_id, stack_profile_path = sys.argv[1:7]

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

# --- Tier detection ---
# 1. Match against test_lanes in stack-profile.json
tier = 'unknown'
tier_reason = 'no match'

stack_lanes = {}
if os.path.isfile(stack_profile_path):
    try:
        with open(stack_profile_path) as f:
            sp = json.load(f)
        stack_lanes = sp.get('test_lanes', {})
    except (json.JSONDecodeError, OSError):
        pass

# Check stack-profile lanes first (most reliable)
for lane_name, lane_info in stack_lanes.items():
    lane_cmd = lane_info.get('command', '')
    # Match if the lane command appears in the executed command
    if lane_cmd and lane_cmd in cmd:
        tier = lane_info.get('tier', lane_name)
        tier_reason = f'matched test_lanes.{lane_name} command'
        break

# 2. Fallback heuristic from the command itself
if tier == 'unknown':
    if 'playwright' in cmd:
        tier = 'e2e'
        tier_reason = 'command contains playwright'
    elif 'test:local' in cmd or 'runInBand' in cmd:
        tier = 'integration'
        tier_reason = 'command uses test:local or runInBand (real DB expected)'
    elif 'jest' in cmd or 'npm test' in cmd or 'npm run test' in cmd:
        tier = 'mocked'
        tier_reason = 'generic test command (assumed mocked)'

# 3. Refine from output content
db_connected = False
if 'DATABASE_URL' in response_text or 'Connected to' in response_text or 'PostgreSQL' in response_text:
    db_connected = True
    if tier == 'mocked':
        tier = 'integration'
        tier_reason = 'output indicates real database connection'

# Parse jest output for suite/test counts
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

counts_verified = bool(suite_match)

# Capture last 100 lines of output
output_lines = response_text.strip().split('\n')
output_tail = '\n'.join(output_lines[-100:]) if len(output_lines) > 100 else response_text.strip()

timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

evidence = {
    'type': 'test-run',
    'timestamp': timestamp,
    'commit': commit,
    'branch': branch,
    'command': cmd,
    'mode': mode,
    'tier': tier,
    'tier_reason': tier_reason,
    'db_connected': db_connected,
    'result': {
        'suites_passed': suites_passed,
        'suites_failed': suites_failed,
        'suites_skipped': suites_skipped,
        'tests_passed': tests_passed,
        'tests_failed': tests_failed,
        'exit_code': exit_code
    },
    'output_tail': output_tail,
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

    tier_labels = {
        'mocked': 'mocked (no real services)',
        'integration': 'integration (real database)',
        'e2e': 'E2E (browser, real stack)',
        'unknown': 'unknown'
    }
    tier_label = tier_labels.get(tier, tier)

    # --- Load existing history from vault note ---
    history_rows = []
    if os.path.isfile(vault_note_path):
        try:
            with open(vault_note_path) as f:
                existing = f.read()
            in_history = False
            for line in existing.split('\n'):
                if line.strip().startswith('| Time'):
                    in_history = True
                    continue
                if line.strip().startswith('|---'):
                    continue
                if in_history and line.strip().startswith('|'):
                    history_rows.append(line.strip())
                elif in_history and not line.strip().startswith('|'):
                    in_history = False
        except OSError:
            pass

    # Add current run to history (keep last 20)
    short_time = timestamp[11:16]  # HH:MM
    result_label = 'PASS' if ev_status == 'green' else 'RED'
    if tier == 'mocked':
        result_label += ' (mocked only)'
    new_row = f'| {short_time} | {tier} | {suites_passed}/{suites_passed + suites_failed} | {commit} | {result_label} |'
    history_rows.insert(0, new_row)
    history_rows = history_rows[:20]

    history_table = '| Time | Tier | Suites | Commit | Result |\n|------|------|--------|--------|--------|\n'
    history_table += '\n'.join(history_rows)

    # Truncate output for vault note (last 50 lines to keep note size reasonable)
    vault_output = '\n'.join(output_lines[-50:]) if len(output_lines) > 50 else response_text.strip()

    vault_note = f"""---
id: evidence_{project_name}_test_run
type: evidence
project: {project_name}
module: verification
tier: {tier}
status: {ev_status}
priority: low
branch: {branch}
commit: {commit}
created: {timestamp}
updated: {timestamp}
tags:
  - test-evidence
  - automated
  - {mode}
  - tier-{tier}
---

# Test Evidence: {project_name}

## Latest Run
- **Tier**: {tier_label}
- **Tier reason**: {tier_reason}
- **Command**: `{cmd}`
- **Mode**: {mode}
- **Suites**: {suites_passed} passed, {suites_failed} failed, {suites_skipped} skipped
- **Tests**: {tests_passed} passed, {tests_failed} failed
- **Exit code**: {exit_code}
- **Commit**: `{commit}`
- **Branch**: `{branch}`
- **Time**: {timestamp}
- **DB connected**: {db_connected}
- **Status**: {'GREEN' if ev_status == 'green' else 'RED'}
- **Stale**: False

## Output (last 50 lines)
```
{vault_output}
```

## Quality Verdict
{'REAL PROOF — integration/e2e tests hit real services' if tier in ('integration', 'e2e') else 'THEATRE — mocked tests only, does not prove code works against real services'}

## History
{history_table}
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
