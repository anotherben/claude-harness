#!/bin/bash
set -euo pipefail

# conductor/resume.sh — Load fleet state + handovers for next-day resume
# Usage: bash ~/claude-harness/conductor/resume.sh [--dispatch-id conductor-20260318-1430]

# --- Defaults ---
DISPATCH_ID=""
JSON_OUTPUT=false

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dispatch-id) DISPATCH_ID="$2"; shift 2 ;;
    --json)        JSON_OUTPUT=true; shift ;;
    -h|--help)
      cat <<'USAGE'
conductor/resume.sh — Resume from fleet state + handovers

FLAGS:
  --dispatch-id <id>   Resume a specific dispatch (default: latest)
  --json               Output as JSON instead of human-readable
USAGE
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# --- Detect Obsidian vault ---
VAULT_PATH=""
if [ -f "$HOME/claude-harness/harness.json" ]; then
  VAULT_PATH="$(python3 -c "import json; print(json.load(open('$HOME/claude-harness/harness.json')).get('vault_path', ''))" 2>/dev/null || true)"
fi
if [ -z "$VAULT_PATH" ] || [ ! -d "$VAULT_PATH" ]; then
  for candidate in "$HOME/Documents/Vault" "$HOME/vault" "$HOME/obsidian"; do
    if [ -d "$candidate" ]; then
      VAULT_PATH="$candidate"
      break
    fi
  done
fi

EVIDENCE_DIR="$VAULT_PATH/_evidence/conductor"

if [ ! -d "$EVIDENCE_DIR" ]; then
  echo "No conductor evidence found at $EVIDENCE_DIR" >&2
  exit 1
fi

# --- Find fleet state ---
FLEET_STATE_FILE=""
if [ -n "$DISPATCH_ID" ]; then
  # Look for specific dispatch
  FLEET_STATE_FILE="$(find "$EVIDENCE_DIR" -name "*fleet-state.json" -exec grep -l "$DISPATCH_ID" {} \; 2>/dev/null | head -1)"
  if [ -z "$FLEET_STATE_FILE" ]; then
    echo "Error: dispatch ID not found: $DISPATCH_ID" >&2
    exit 1
  fi
else
  # Find latest fleet state
  FLEET_STATE_FILE="$(ls -t "$EVIDENCE_DIR"/*fleet-state.json 2>/dev/null | head -1)"
  if [ -z "$FLEET_STATE_FILE" ]; then
    echo "No fleet state files found in $EVIDENCE_DIR" >&2
    exit 1
  fi
fi

# --- Parse fleet state ---
FLEET_JSON="$(cat "$FLEET_STATE_FILE")"
DISPATCH_ID_RESOLVED="$(python3 -c "import json; print(json.load(open('$FLEET_STATE_FILE')).get('dispatch_id', 'unknown'))")"
PROJECT="$(python3 -c "import json; print(json.load(open('$FLEET_STATE_FILE')).get('project', 'unknown'))")"
STARTED="$(python3 -c "import json; print(json.load(open('$FLEET_STATE_FILE')).get('started', 'unknown'))")"

# --- JSON output ---
if [ "$JSON_OUTPUT" = true ]; then
  python3 -c "
import json, os, subprocess

with open('$FLEET_STATE_FILE') as f:
    state = json.load(f)

resume = {
    'dispatch_id': state.get('dispatch_id'),
    'project': state.get('project'),
    'started': state.get('started'),
    'workers': [],
    'recommended_actions': []
}

for w in state.get('workers', []):
    worker = dict(w)

    # Read handover if exists
    handover_path = w.get('handover', '')
    if handover_path and os.path.isfile(handover_path):
        with open(handover_path) as hf:
            worker['handover_content'] = hf.read()[:2000]

    # Check branch exists
    branch = w.get('branch', '')
    if branch:
        try:
            result = subprocess.run(
                ['git', 'rev-parse', '--verify', branch],
                capture_output=True, text=True, timeout=5
            )
            worker['branch_exists'] = result.returncode == 0
            if result.returncode == 0:
                log = subprocess.run(
                    ['git', 'log', '--oneline', '-5', branch],
                    capture_output=True, text=True, timeout=5
                )
                worker['recent_commits'] = log.stdout.strip().split('\n') if log.stdout.strip() else []
        except:
            worker['branch_exists'] = False

    resume['workers'].append(worker)

    # Build recommendations
    merge_status = state.get('merge_status', {}).get(w.get('name', ''), '')
    if merge_status == 'pending-verify':
        resume['recommended_actions'].append(f\"/enterprise-verify on branch {branch}\")
    elif merge_status == 'needs-redispatch':
        resume['recommended_actions'].append(f\"Redispatch {w.get('name')} with higher budget\")

print(json.dumps(resume, indent=2))
"
  exit 0
fi

# --- Human-readable output ---
echo ""
echo -e "${BOLD}CONDUCTOR RESUME${NC} — ${DISPATCH_ID_RESOLVED}"
echo -e "Project: ${PROJECT} | Started: ${STARTED}"
echo ""

# Process each worker
python3 -c "
import json, os, subprocess

with open('$FLEET_STATE_FILE') as f:
    state = json.load(f)

completed = []
failed = []
merge_status = state.get('merge_status', {})

for w in state.get('workers', []):
    name = w.get('name', 'unknown')
    model = w.get('model', '?')
    cost = w.get('cost_usd', 0)
    branch = w.get('branch', '')
    session_id = w.get('session_id', '')
    status = w.get('status', 'unknown')
    stop_reason = w.get('stop_reason', '')
    handover_path = w.get('handover', '')

    # Read handover summary (first 3 non-empty, non-header lines)
    handover_summary = ''
    if handover_path and os.path.isfile(handover_path):
        with open(handover_path) as hf:
            lines = [l.strip() for l in hf.readlines() if l.strip() and not l.startswith('#') and not l.startswith('---')]
            handover_summary = lines[0] if lines else 'No summary'

    # Check branch
    branch_info = ''
    if branch:
        try:
            result = subprocess.run(['git', 'log', '--oneline', '-1', branch],
                                    capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                commit_count = subprocess.run(['git', 'rev-list', '--count', f'dev..{branch}'],
                                              capture_output=True, text=True, timeout=5)
                count = commit_count.stdout.strip() if commit_count.returncode == 0 else '?'
                branch_info = f'{count} commits'
            else:
                branch_info = 'branch not found'
        except:
            branch_info = 'could not check'

    if status == 'complete':
        completed.append({
            'name': name, 'model': model, 'cost': cost,
            'branch': branch, 'branch_info': branch_info,
            'handover': handover_summary, 'session_id': session_id
        })
    else:
        failed.append({
            'name': name, 'model': model, 'cost': cost,
            'branch': branch, 'stop_reason': stop_reason,
            'handover': handover_summary, 'session_id': session_id
        })

if completed:
    print('\033[1mCOMPLETED (pending verify + merge):\033[0m')
    for w in completed:
        print(f\"  {w['name']}  [{w['model']} \${w['cost']:.2f}]  branch: {w['branch']}  {w['branch_info']}\")
        if w['handover']:
            print(f\"    -> {w['handover']}\")
    print()

if failed:
    print('\033[1mFAILED (needs redispatch):\033[0m')
    for w in failed:
        print(f\"  {w['name']}  [{w['model']} \${w['cost']:.2f}]  {w['stop_reason']}\")
        if w['handover']:
            print(f\"    -> {w['handover']}\")
    print()

# Recommendations
print('\033[1mRECOMMENDED NEXT STEPS:\033[0m')
step = 1
for w in completed:
    m = merge_status.get(w['name'], '')
    if m == 'pending-verify':
        print(f\"  {step}. /enterprise-verify on branch {w['branch']}\")
        step += 1
for w in failed:
    print(f\"  {step}. Redispatch {w['name']} with higher budget (session: {w['session_id'][:8]}...)\")
    step += 1
if completed:
    branches = ', '.join(w['branch'] for w in completed)
    print(f\"  {step}. Merge completed branches in order: {branches}\")
print()
"
