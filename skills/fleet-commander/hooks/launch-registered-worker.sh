#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/fleet-common.sh"

ITEM_ID=""
PROJECT=""
REPO_PATH=""
BRANCH=""
WORKTREE_PATH=""
COMMAND=""
MESSAGE=""
GROUP=""
BASE_REF="dev"
SESSION_TITLE=""
OWNER_FAMILY="claude"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --item-id) ITEM_ID="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --repo-path) REPO_PATH="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --worktree-path) WORKTREE_PATH="$2"; shift 2 ;;
    --cmd) COMMAND="$2"; shift 2 ;;
    --message) MESSAGE="$2"; shift 2 ;;
    --group) GROUP="$2"; shift 2 ;;
    --base-ref) BASE_REF="$2"; shift 2 ;;
    --session-title) SESSION_TITLE="$2"; shift 2 ;;
    --owner-family) OWNER_FAMILY="$2"; shift 2 ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

[ -n "$ITEM_ID" ] || { echo "--item-id is required" >&2; exit 1; }
[ -n "$REPO_PATH" ] || { echo "--repo-path is required" >&2; exit 1; }
[ -n "$BRANCH" ] || { echo "--branch is required" >&2; exit 1; }
[ -n "$WORKTREE_PATH" ] || { echo "--worktree-path is required" >&2; exit 1; }
[ -n "$COMMAND" ] || { echo "--cmd is required" >&2; exit 1; }

if [ -z "$SESSION_TITLE" ]; then
  SESSION_TITLE="$(sanitize_label "${OWNER_FAMILY}-${ITEM_ID}")"
fi

WORKER_ID="$(sanitize_label "$SESSION_TITLE")"
OWNER_INSTANCE="${OWNER_FAMILY}:deck:${WORKER_ID}"

ORCH_JSON=$(ensure_agent_deck_orchestrator "$OWNER_FAMILY")
ORCHESTRATOR_ID=$(printf '%s' "$ORCH_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["orchestrator_id"])')

open_args=(
  open-dispatch-run
  --orchestrator-id "$ORCHESTRATOR_ID"
  --vault-item-id "$ITEM_ID"
  --repo-path "$REPO_PATH"
  --branch "$BRANCH"
  --worktree-path "$WORKTREE_PATH"
  --requested-by "$OWNER_INSTANCE"
)
if [ -n "$PROJECT" ]; then
  open_args+=(--project "$PROJECT")
fi

RUN_JSON=$(registry_cli "${open_args[@]}")
RUN_ID=$(printf '%s' "$RUN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["run_id"])')

if [ ! -d "$WORKTREE_PATH" ]; then
  if git -C "$REPO_PATH" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$REPO_PATH" worktree add "$WORKTREE_PATH" "$BRANCH" >/dev/null
  else
    git -C "$REPO_PATH" worktree add "$WORKTREE_PATH" -b "$BRANCH" "$BASE_REF" >/dev/null
  fi
fi

launch_args=("$AGENT_DECK_BIN" launch "$WORKTREE_PATH" -title "$SESSION_TITLE" -cmd "$COMMAND" -no-wait)
if [ -n "$GROUP" ]; then
  launch_args+=(-group "$GROUP")
fi
if [ -n "$MESSAGE" ]; then
  launch_args+=(-message "$MESSAGE")
fi

"${launch_args[@]}" >/dev/null

registry_cli register-worker \
  --run-id "$RUN_ID" \
  --vault-item-id "$ITEM_ID" \
  --owner-family "$OWNER_FAMILY" \
  --owner-instance "$OWNER_INSTANCE" \
  --agent-deck-session "$SESSION_TITLE" \
  --repo-path "$REPO_PATH" \
  --branch "$BRANCH" \
  --worktree-path "$WORKTREE_PATH" \
  --worker-id "$WORKER_ID"
