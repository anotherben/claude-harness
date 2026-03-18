#!/bin/bash
set -euo pipefail

# conductor/dispatch.sh — Launch a governed Claude Code CLI worker session
# Usage: bash ~/claude-harness/conductor/dispatch.sh --task-file /path/to/task.md --model sonnet --budget 2.00 --worktree fix-bug

# --- Defaults ---
TASK=""
TASK_FILE=""
MODEL="sonnet"
BUDGET="2.00"
WORKTREE=""
NAME=""
SYSTEM_EXTRA=""
PROJECT_DIR="$(pwd)"
TIMEOUT=600
DISPATCH_DIR="/tmp/conductor-$$"
STREAM=false
PERMISSION_MODE=""

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

info()  { echo -e "${BLUE}[conductor]${NC} $1" >&2; }
ok()    { echo -e "${GREEN}[conductor]${NC} $1" >&2; }
warn()  { echo -e "${YELLOW}[conductor]${NC} $1" >&2; }
err()   { echo -e "${RED}[conductor]${NC} $1" >&2; }

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --task)         TASK="$2"; shift 2 ;;
    --task-file)    TASK_FILE="$2"; shift 2 ;;
    --model)        MODEL="$2"; shift 2 ;;
    --budget)       BUDGET="$2"; shift 2 ;;
    --worktree)     WORKTREE="$2"; shift 2 ;;
    --name)         NAME="$2"; shift 2 ;;
    --system)       SYSTEM_EXTRA="$2"; shift 2 ;;
    --project)      PROJECT_DIR="$2"; shift 2 ;;
    --timeout)      TIMEOUT="$2"; shift 2 ;;
    --dispatch-dir) DISPATCH_DIR="$2"; shift 2 ;;
    --stream)       STREAM=true; shift ;;
    --permission-mode) PERMISSION_MODE="$2"; shift 2 ;;
    -h|--help)
      cat <<'USAGE'
conductor/dispatch.sh — Launch a governed Claude Code CLI worker session

FLAGS:
  --task <prompt>         Inline task description
  --task-file <path>      Path to structured task spec file (preferred)
  --model <model>         Model: opus, sonnet, haiku (default: sonnet)
  --budget <usd>          Max spend in USD (default: 2.00)
  --worktree <name>       Create isolated worktree (recommended for parallel)
  --name <label>          Session label for identification
  --system <text>         Extra system prompt to append
  --project <path>        Project directory (default: cwd)
  --timeout <seconds>     Max wall-clock time (default: 600)
  --dispatch-dir <path>   Where to write result JSON (default: /tmp/conductor-$$)
  --stream                Use stream-json output for real-time progress
  --permission-mode <m>   Permission mode (default: uses project settings)

One of --task or --task-file is required. --task-file is preferred.
USAGE
      exit 0
      ;;
    *) err "Unknown flag: $1"; exit 1 ;;
  esac
done

# --- Validate ---
if [ -z "$TASK" ] && [ -z "$TASK_FILE" ]; then
  err "One of --task or --task-file is required"
  exit 1
fi

if [ -n "$TASK_FILE" ]; then
  if [ ! -f "$TASK_FILE" ]; then
    err "Task file not found: $TASK_FILE"
    exit 1
  fi
  TASK="$(cat "$TASK_FILE")"
fi

if [ -z "$TASK" ]; then
  err "Task is empty"
  exit 1
fi

# --- Derive name ---
if [ -z "$NAME" ]; then
  if [ -n "$WORKTREE" ]; then
    NAME="$WORKTREE"
  elif [ -n "$TASK_FILE" ]; then
    NAME="$(basename "$TASK_FILE" .md)"
  else
    NAME="worker-$(date +%s)"
  fi
fi

# --- Generate session ID ---
SESSION_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

# --- Setup dispatch directory ---
mkdir -p "$DISPATCH_DIR"
RESULT_FILE="$DISPATCH_DIR/${NAME}-result.json"

# --- Detect Obsidian vault ---
VAULT_PATH=""
# Check harness.json for vault path
if [ -f "$HOME/claude-harness/harness.json" ]; then
  VAULT_PATH="$(python3 -c "import json; print(json.load(open('$HOME/claude-harness/harness.json')).get('vault_path', ''))" 2>/dev/null || true)"
fi
# Fallback: check common locations
if [ -z "$VAULT_PATH" ] || [ ! -d "$VAULT_PATH" ]; then
  for candidate in "$HOME/Documents/Vault" "$HOME/vault" "$HOME/obsidian"; do
    if [ -d "$candidate" ]; then
      VAULT_PATH="$candidate"
      break
    fi
  done
fi

# --- Handover path ---
DATE_STAMP="$(date +%Y-%m-%d)"
HANDOVER_PATH=""
if [ -n "$VAULT_PATH" ]; then
  mkdir -p "$VAULT_PATH/_evidence/conductor"
  HANDOVER_PATH="$VAULT_PATH/_evidence/conductor/${DATE_STAMP}-${NAME}-handover.md"
else
  HANDOVER_PATH="$DISPATCH_DIR/${NAME}-handover.md"
fi

# --- Build system prompt ---
WORKER_SYSTEM="You are a conductor worker — one of several agents dispatched by an orchestrator to work on part of a larger project. You build; the orchestrator verifies and merges.

YOUR JOB:
1. Read the task spec. It has everything: files to change, acceptance criteria, test commands, and a commit prefix. Follow it literally.
2. Verify the FILES listed exist. If a file listed under FILES does not exist in the repo, STOP — do not create it. Write your findings to the handover and exit. The orchestrator wrote the spec wrong; they will fix it and redispatch.
3. Implement the changes.
4. Run the TEST COMMAND from the task spec to verify your work.
5. Commit using the prefix from the task spec. Hooks enforce evidence, lint, and vault — if one blocks you, fix the root cause (that is the system working correctly).
6. As your final action, write a short handover to ${HANDOVER_PATH}.

WHAT COUNTS AS OUT OF SCOPE:
- Files not listed under FILES — even if they have bugs, even if your change would be better with them fixed. Note them in the handover; the orchestrator will create a separate task.
- Refactoring, cleanup, or improvements to surrounding code — even obviously bad code. You are not here to improve the neighborhood.
- Creating new files that are not listed in the task spec — if the spec says modify a file, it must already exist.

WHY BOUNDARIES EXIST:
- A separate agent verifies and reviews your branch. That is why /enterprise-verify, /enterprise-review, /enterprise-forge, and /enterprise-harness are disabled for you — builders cannot review their own work.
- The Agent tool is disabled because workers do not dispatch workers — the orchestrator manages parallelism and dependencies.
- DO NOT TOUCH files exist because other workers may be editing them concurrently. Touching them creates merge conflicts that block the fleet.
- Scope discipline matters because the orchestrator sized this task for one session. Expanding scope burns budget and creates unreviewed surface area.

HANDOVER (write to ${HANDOVER_PATH} as your last action):
  ## Worker Handover: ${NAME}
  **Status:** complete | partial | blocked
  **Commits:** {hash + message for each, or none if blocked}
  **Acceptance criteria:** {checklist — pass/fail each item from the task spec}
  **Decisions made:** {any judgment calls, or none}
  **Blockers:** {anything that stopped you, or none}

If the task is unclear, a file is missing, or the task is impossible — write what you found to the handover and exit cleanly. The orchestrator will redispatch or adjust."

if [ -n "$SYSTEM_EXTRA" ]; then
  WORKER_SYSTEM="${WORKER_SYSTEM}

${SYSTEM_EXTRA}"
fi

# --- Disallowed tools ---
DISALLOWED="Agent Skill(enterprise-verify) Skill(enterprise-review) Skill(enterprise-forge) Skill(enterprise-harness)"

# --- Build CLI command ---
CLI_ARGS=(
  claude
  -p "$TASK"
  --output-format json
  --model "$MODEL"
  --max-budget-usd "$BUDGET"
  --session-id "$SESSION_ID"
  --name "conductor-${NAME}"
  --disallowed-tools "$DISALLOWED"
  --append-system-prompt "$WORKER_SYSTEM"
)

# Add worktree if requested
if [ -n "$WORKTREE" ]; then
  CLI_ARGS+=(--worktree "$WORKTREE")
fi

# Add permission mode if specified
if [ -n "$PERMISSION_MODE" ]; then
  CLI_ARGS+=(--permission-mode "$PERMISSION_MODE")
fi

# Stream mode: use stream-json + verbose
if [ "$STREAM" = true ]; then
  CLI_ARGS=(
    claude
    -p "$TASK"
    --output-format stream-json
    --verbose
    --model "$MODEL"
    --max-budget-usd "$BUDGET"
    --session-id "$SESSION_ID"
    --name "conductor-${NAME}"
    --disallowed-tools "$DISALLOWED"
    --append-system-prompt "$WORKER_SYSTEM"
  )
  if [ -n "$WORKTREE" ]; then
    CLI_ARGS+=(--worktree "$WORKTREE")
  fi
  if [ -n "$PERMISSION_MODE" ]; then
    CLI_ARGS+=(--permission-mode "$PERMISSION_MODE")
  fi
fi

# --- Log dispatch metadata ---
START_TIME="$(date +%s)"
START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

info "Dispatching worker: ${NAME}"
info "  Model:      ${MODEL}"
info "  Budget:     \$${BUDGET}"
info "  Session:    ${SESSION_ID}"
info "  Worktree:   ${WORKTREE:-none}"
info "  Dispatch:   ${DISPATCH_DIR}"
info "  Handover:   ${HANDOVER_PATH}"

# Write pre-dispatch metadata
cat > "$DISPATCH_DIR/${NAME}-meta.json" <<META_EOF
{
  "name": "${NAME}",
  "session_id": "${SESSION_ID}",
  "model": "${MODEL}",
  "budget_usd": ${BUDGET},
  "worktree": "${WORKTREE}",
  "project_dir": "${PROJECT_DIR}",
  "task_file": "${TASK_FILE}",
  "handover_path": "${HANDOVER_PATH}",
  "started": "${START_ISO}",
  "dispatch_dir": "${DISPATCH_DIR}",
  "status": "running"
}
META_EOF

# --- Execute ---
CLAUDE_OUTPUT=""
EXIT_CODE=0

if [ "$STREAM" = true ]; then
  # Stream mode: tee progress to stderr, capture final JSON
  STREAM_FILE="$DISPATCH_DIR/${NAME}-stream.jsonl"
  "${CLI_ARGS[@]}" 2>&1 | tee "$STREAM_FILE" | while IFS= read -r line; do
    # Extract and display progress messages
    MSG_TYPE="$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get('type',''))" 2>/dev/null || true)"
    if [ "$MSG_TYPE" = "assistant" ]; then
      echo -e "${DIM}[${NAME}] working...${NC}" >&2
    fi
  done || EXIT_CODE=$?

  # Extract final result from stream
  CLAUDE_OUTPUT="$(tail -1 "$STREAM_FILE" 2>/dev/null || echo '{}')"
else
  # Standard mode: capture JSON output
  CLAUDE_OUTPUT="$(timeout "$TIMEOUT" "${CLI_ARGS[@]}" 2>/dev/null)" || EXIT_CODE=$?
fi

END_TIME="$(date +%s)"
DURATION_MS=$(( (END_TIME - START_TIME) * 1000 ))

# --- Parse result ---
if [ $EXIT_CODE -ne 0 ] && [ -z "$CLAUDE_OUTPUT" ]; then
  # Worker crashed or timed out
  CLAUDE_OUTPUT="{}"
  warn "Worker exited with code ${EXIT_CODE}"
fi

# Extract fields from Claude JSON output
parse_json_field() {
  local json="$1" field="$2" default="$3"
  python3 -c "
import sys, json
try:
    data = json.loads(sys.argv[1])
    val = data.get(sys.argv[2], sys.argv[3])
    print(val if val is not None else sys.argv[3])
except:
    print(sys.argv[3])
" "$json" "$field" "$default" 2>/dev/null
}

COST_USD="$(parse_json_field "$CLAUDE_OUTPUT" "cost_usd" "0")"
RESULT_TEXT="$(parse_json_field "$CLAUDE_OUTPUT" "result" "")"
STOP_REASON="$(parse_json_field "$CLAUDE_OUTPUT" "stop_reason" "unknown")"
NUM_TURNS="$(parse_json_field "$CLAUDE_OUTPUT" "num_turns" "0")"
SESSION_ID_OUT="$(parse_json_field "$CLAUDE_OUTPUT" "session_id" "$SESSION_ID")"

# Determine success
SUCCESS=false
if [ $EXIT_CODE -eq 0 ] && [ "$STOP_REASON" != "budget_exhausted" ]; then
  SUCCESS=true
fi

# Detect worktree path and branch
WORKTREE_PATH=""
BRANCH=""
if [ -n "$WORKTREE" ]; then
  # Claude CLI creates worktrees — detect the path
  for candidate in ".claude/worktrees/${WORKTREE}" ".worktrees/${WORKTREE}"; do
    if [ -d "$PROJECT_DIR/$candidate" ]; then
      WORKTREE_PATH="$candidate"
      BRANCH="$(cd "$PROJECT_DIR/$candidate" && git branch --show-current 2>/dev/null || echo "conductor/${WORKTREE}")"
      break
    fi
  done
  if [ -z "$BRANCH" ]; then
    BRANCH="conductor/${WORKTREE}"
  fi
fi

# --- Write result JSON ---
cat > "$RESULT_FILE" <<RESULT_EOF
{
  "success": ${SUCCESS},
  "session_id": "${SESSION_ID_OUT}",
  "cost_usd": ${COST_USD},
  "duration_ms": ${DURATION_MS},
  "turns": ${NUM_TURNS},
  "result": $(python3 -c "import json; print(json.dumps('''${RESULT_TEXT}'''[:500]))" 2>/dev/null || echo '""'),
  "stop_reason": "${STOP_REASON}",
  "exit_code": ${EXIT_CODE},
  "worktree": "${WORKTREE_PATH}",
  "branch": "${BRANCH}",
  "handover_path": "${HANDOVER_PATH}",
  "model": "${MODEL}",
  "budget_usd": ${BUDGET},
  "name": "${NAME}",
  "started": "${START_ISO}",
  "ended": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "task_file": "${TASK_FILE}"
}
RESULT_EOF

# --- Persist to Obsidian ---
CONDUCTOR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$CONDUCTOR_DIR/persist.sh" ]; then
  bash "$CONDUCTOR_DIR/persist.sh" \
    --result-file "$RESULT_FILE" \
    --dispatch-dir "$DISPATCH_DIR" \
    --name "$NAME" 2>/dev/null || warn "persist.sh failed (non-fatal)"
fi

# --- Report ---
if [ "$SUCCESS" = true ]; then
  ok "Worker ${NAME} completed successfully"
  ok "  Cost: \$${COST_USD} | Duration: $((DURATION_MS / 1000))s | Turns: ${NUM_TURNS}"
  if [ -n "$BRANCH" ]; then
    ok "  Branch: ${BRANCH}"
  fi
else
  warn "Worker ${NAME} finished with issues"
  warn "  Exit: ${EXIT_CODE} | Stop: ${STOP_REASON} | Cost: \$${COST_USD}"
fi

# --- Output result JSON to stdout for caller ---
cat "$RESULT_FILE"
