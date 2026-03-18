#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/fleet-common.sh"

RUN_ID=""
WORKER_ID=""
WORKER_STATUS="closed"
RUN_STATUS="closed"
OWNER_FAMILY="claude"
OWNER_INSTANCE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --run-id) RUN_ID="$2"; shift 2 ;;
    --worker-id) WORKER_ID="$2"; shift 2 ;;
    --worker-status) WORKER_STATUS="$2"; shift 2 ;;
    --run-status) RUN_STATUS="$2"; shift 2 ;;
    --owner-family) OWNER_FAMILY="$2"; shift 2 ;;
    --owner-instance) OWNER_INSTANCE="$2"; shift 2 ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

[ -n "$RUN_ID" ] || { echo "--run-id is required" >&2; exit 1; }
if [ -z "$OWNER_INSTANCE" ]; then
  OWNER_INSTANCE="$(current_worker_owner_instance "$OWNER_FAMILY")"
fi
[ -n "$OWNER_INSTANCE" ] || { echo "unable to resolve owner instance" >&2; exit 1; }

if [ -n "$WORKER_ID" ]; then
  registry_cli close-worker \
    --worker-id "$WORKER_ID" \
    --owner-instance "$OWNER_INSTANCE" \
    --status "$WORKER_STATUS" >/dev/null
fi

ORCH_JSON=$(ensure_agent_deck_orchestrator "$OWNER_FAMILY")
ORCHESTRATOR_ID=$(printf '%s' "$ORCH_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["orchestrator_id"])')

registry_cli close-dispatch-run \
  --run-id "$RUN_ID" \
  --orchestrator-id "$ORCHESTRATOR_ID" \
  --status "$RUN_STATUS"
