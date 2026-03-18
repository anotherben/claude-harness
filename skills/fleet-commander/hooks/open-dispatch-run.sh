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
REQUESTED_BY=""
OWNER_FAMILY="claude"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --item-id) ITEM_ID="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --repo-path) REPO_PATH="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --worktree-path) WORKTREE_PATH="$2"; shift 2 ;;
    --requested-by) REQUESTED_BY="$2"; shift 2 ;;
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

ORCH_JSON=$(ensure_agent_deck_orchestrator "$OWNER_FAMILY")
ORCHESTRATOR_ID=$(printf '%s' "$ORCH_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["orchestrator_id"])')

open_args=(
  open-dispatch-run
  --orchestrator-id "$ORCHESTRATOR_ID"
  --vault-item-id "$ITEM_ID"
  --repo-path "$REPO_PATH"
  --branch "$BRANCH"
  --worktree-path "$WORKTREE_PATH"
  --requested-by "${REQUESTED_BY:-$OWNER_FAMILY}"
)
if [ -n "$PROJECT" ]; then
  open_args+=(--project "$PROJECT")
fi

registry_cli "${open_args[@]}"
