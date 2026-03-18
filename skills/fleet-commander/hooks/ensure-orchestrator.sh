#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/fleet-common.sh"

OWNER_FAMILY="${1:-claude}"
ensure_agent_deck_orchestrator "$OWNER_FAMILY"
