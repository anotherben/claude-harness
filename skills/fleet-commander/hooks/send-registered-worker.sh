#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/fleet-common.sh"

SESSION_TITLE=""
REPO_PATH=""
BRANCH=""
WORKTREE_PATH=""
ITEM_ID=""
MESSAGE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --session-title) SESSION_TITLE="$2"; shift 2 ;;
    --repo-path) REPO_PATH="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --worktree-path) WORKTREE_PATH="$2"; shift 2 ;;
    --item-id) ITEM_ID="$2"; shift 2 ;;
    --message) MESSAGE="$2"; shift 2 ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

[ -n "$SESSION_TITLE" ] || { echo "--session-title is required" >&2; exit 1; }
[ -n "$REPO_PATH" ] || { echo "--repo-path is required" >&2; exit 1; }
[ -n "$BRANCH" ] || { echo "--branch is required" >&2; exit 1; }
[ -n "$WORKTREE_PATH" ] || { echo "--worktree-path is required" >&2; exit 1; }
[ -n "$MESSAGE" ] || { echo "--message is required" >&2; exit 1; }

check_args=(
  check-dispatch
  --profile-name "$ORCHESTRATOR_PROFILE"
  --conductor-name "$ORCHESTRATOR_NAME"
  --fleet-session "$SESSION_TITLE"
  --repo-path "$REPO_PATH"
  --branch "$BRANCH"
  --worktree-path "$WORKTREE_PATH"
)
if [ -n "$ITEM_ID" ]; then
  check_args+=(--item-id "$ITEM_ID")
fi

CHECK_JSON=$(registry_cli "${check_args[@]}")
CHECK_OK=$(printf '%s' "$CHECK_JSON" | python3 -c 'import json,sys; data=json.load(sys.stdin); print("1" if data.get("ok") and data.get("result", {}).get("ok") else "")' 2>/dev/null || true)
if [ -z "$CHECK_OK" ]; then
  echo "$CHECK_JSON" >&2
  exit 1
fi

"$FLEET_CLI_BIN" session send "$SESSION_TITLE" "$MESSAGE"
