#!/bin/bash
# PostToolUse:Bash — mark test evidence stale after git state changes
# When git state changes, all prior test results become unreliable.
# Marks both local JSON and Obsidian vault note as stale.

EVIDENCE_FILE="$CLAUDE_PROJECT_DIR/.claude/evidence/last-test-run.json"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

if echo "$COMMAND" | grep -qE 'git (merge|revert|pull|checkout|cherry-pick|reset)'; then
  # Mark local JSON evidence stale
  if [ -f "$EVIDENCE_FILE" ]; then
    python3 - "$EVIDENCE_FILE" << 'PYEOF'
import json, sys
evidence_file = sys.argv[1]
with open(evidence_file) as f:
    data = json.load(f)
data['stale'] = True
with open(evidence_file, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
PYEOF
  fi

  # Mark Obsidian vault evidence note stale
  python3 - "$CLAUDE_PROJECT_DIR" << 'PYEOF'
import os, sys, glob

project_dir = sys.argv[1] if len(sys.argv) > 1 else ''
project_name = os.path.basename(project_dir) if project_dir else None

evidence_dir = os.path.expanduser('${OBSIDIAN_VAULT_PATH:-~/Documents/Vault}/_evidence')
if not os.path.isdir(evidence_dir):
    sys.exit(0)

# Mark the specific project's evidence stale, or all if unknown
if project_name:
    targets = [os.path.join(evidence_dir, f'{project_name}-test-evidence.md')]
else:
    targets = glob.glob(os.path.join(evidence_dir, '*-test-evidence.md'))

for vault_note in targets:
    if os.path.exists(vault_note):
        with open(vault_note, 'r') as f:
            content = f.read()
        content = content.replace('status: green', 'status: stale')
        content = content.replace('status: red', 'status: stale')
        content = content.replace('**Stale:** False', '**Stale:** True (git state changed)')
        with open(vault_note, 'w') as f:
            f.write(content)
PYEOF

  # Clean up legacy /tmp markers
  rm -f "/tmp/claude-test-ran-${SESSION_ID}" 2>/dev/null
  rm -f "/tmp/claude-tests-last-run" 2>/dev/null

  echo "GIT STATE CHANGED — ALL PRIOR TEST RESULTS ARE NOW STALE."
  echo "You MUST re-run verification on current HEAD before making any claims."
  echo "Any test result from before this git operation is INVALID."
  echo "Proof-or-STFU: paste fresh test output or say UNVERIFIED."
fi

exit 0
