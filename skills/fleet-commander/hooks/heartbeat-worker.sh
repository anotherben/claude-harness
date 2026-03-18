#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/fleet-common.sh"

WORKER_ID=""
OWNER_FAMILY="claude"
OWNER_INSTANCE=""
LEASE_SECONDS="900"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --worker-id) WORKER_ID="$2"; shift 2 ;;
    --owner-family) OWNER_FAMILY="$2"; shift 2 ;;
    --owner-instance) OWNER_INSTANCE="$2"; shift 2 ;;
    --lease-seconds) LEASE_SECONDS="$2"; shift 2 ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

[ -n "$WORKER_ID" ] || { echo "--worker-id is required" >&2; exit 1; }
if [ -z "$OWNER_INSTANCE" ]; then
  OWNER_INSTANCE="$(current_worker_owner_instance "$OWNER_FAMILY")"
fi
[ -n "$OWNER_INSTANCE" ] || { echo "unable to resolve owner instance" >&2; exit 1; }

registry_cli heartbeat-worker \
  --worker-id "$WORKER_ID" \
  --owner-instance "$OWNER_INSTANCE" \
  --lease-seconds "$LEASE_SECONDS"
