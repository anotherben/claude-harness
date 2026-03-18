#!/bin/bash
set -euo pipefail

# conductor/persist.sh — Copy worker artifacts to Obsidian vault
# Called by dispatch.sh after worker exits. Also callable standalone.
# Usage: bash ~/claude-harness/conductor/persist.sh --result-file /tmp/conductor-123/fix-bug-result.json --dispatch-dir /tmp/conductor-123 --name fix-bug

# --- Defaults ---
RESULT_FILE=""
DISPATCH_DIR=""
NAME=""

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --result-file)  RESULT_FILE="$2"; shift 2 ;;
    --dispatch-dir) DISPATCH_DIR="$2"; shift 2 ;;
    --name)         NAME="$2"; shift 2 ;;
    -h|--help)
      cat <<'USAGE'
conductor/persist.sh — Copy worker artifacts to Obsidian vault

FLAGS:
  --result-file <path>    Path to worker result JSON (required)
  --dispatch-dir <path>   Dispatch directory (required)
  --name <label>          Worker name (required)
USAGE
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$RESULT_FILE" ] || [ -z "$DISPATCH_DIR" ] || [ -z "$NAME" ]; then
  echo "Error: --result-file, --dispatch-dir, and --name are all required" >&2
  exit 1
fi

if [ ! -f "$RESULT_FILE" ]; then
  echo "Error: result file not found: $RESULT_FILE" >&2
  exit 1
fi

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

if [ -z "$VAULT_PATH" ] || [ ! -d "$VAULT_PATH" ]; then
  echo "Warning: No Obsidian vault found — skipping persistence" >&2
  exit 0
fi

DATE_STAMP="$(date +%Y-%m-%d)"
EVIDENCE_DIR="$VAULT_PATH/_evidence/conductor"
mkdir -p "$EVIDENCE_DIR"

# --- 1. Copy result JSON ---
cp "$RESULT_FILE" "$EVIDENCE_DIR/${DATE_STAMP}-${NAME}-result.json"

# --- 2. Copy handover doc (if worker wrote one) ---
HANDOVER_PATH="$(python3 -c "import json; print(json.load(open('$RESULT_FILE')).get('handover_path', ''))" 2>/dev/null || true)"
if [ -n "$HANDOVER_PATH" ] && [ -f "$HANDOVER_PATH" ]; then
  # Already in vault — just verify it's there
  echo "Handover already at: $HANDOVER_PATH" >&2
elif [ -f "$DISPATCH_DIR/${NAME}-handover.md" ]; then
  # Fallback: copy from dispatch dir
  cp "$DISPATCH_DIR/${NAME}-handover.md" "$EVIDENCE_DIR/${DATE_STAMP}-${NAME}-handover.md"
fi

# --- 3. Update fleet state ---
FLEET_STATE_FILE="$EVIDENCE_DIR/${DATE_STAMP}-fleet-state.json"

# Read existing fleet state or create new
if [ -f "$FLEET_STATE_FILE" ]; then
  python3 -c "
import json, sys

with open('$FLEET_STATE_FILE') as f:
    state = json.load(f)

with open('$RESULT_FILE') as f:
    result = json.load(f)

# Find existing worker entry or add new
worker_entry = {
    'name': result.get('name', '$NAME'),
    'session_id': result.get('session_id', ''),
    'model': result.get('model', ''),
    'status': 'complete' if result.get('success') else 'failed',
    'branch': result.get('branch', ''),
    'cost_usd': result.get('cost_usd', 0),
    'handover': '$EVIDENCE_DIR/${DATE_STAMP}-${NAME}-handover.md',
    'task_file': result.get('task_file', ''),
    'stop_reason': result.get('stop_reason', ''),
    'duration_ms': result.get('duration_ms', 0)
}

# Update or append
found = False
for i, w in enumerate(state.get('workers', [])):
    if w.get('name') == worker_entry['name']:
        state['workers'][i] = worker_entry
        found = True
        break
if not found:
    state.setdefault('workers', []).append(worker_entry)

# Update merge status
merge_status = state.setdefault('merge_status', {})
if result.get('success'):
    merge_status[worker_entry['name']] = 'pending-verify'
else:
    merge_status[worker_entry['name']] = 'needs-redispatch'

with open('$FLEET_STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
" 2>/dev/null
else
  # Create new fleet state
  DISPATCH_ID="conductor-$(date +%Y%m%d-%H%M)"
  python3 -c "
import json

with open('$RESULT_FILE') as f:
    result = json.load(f)

state = {
    'dispatch_id': '$DISPATCH_ID',
    'project': '$(basename "$(pwd)")',
    'started': result.get('started', '$(date -u +%Y-%m-%dT%H:%M:%SZ)'),
    'workers': [{
        'name': result.get('name', '$NAME'),
        'session_id': result.get('session_id', ''),
        'model': result.get('model', ''),
        'status': 'complete' if result.get('success') else 'failed',
        'branch': result.get('branch', ''),
        'cost_usd': result.get('cost_usd', 0),
        'handover': '$EVIDENCE_DIR/${DATE_STAMP}-${NAME}-handover.md',
        'task_file': result.get('task_file', ''),
        'stop_reason': result.get('stop_reason', ''),
        'duration_ms': result.get('duration_ms', 0)
    }],
    'merge_status': {
        result.get('name', '$NAME'): 'pending-verify' if result.get('success') else 'needs-redispatch'
    }
}

with open('$FLEET_STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
" 2>/dev/null
fi

echo "Persisted to: $EVIDENCE_DIR" >&2
