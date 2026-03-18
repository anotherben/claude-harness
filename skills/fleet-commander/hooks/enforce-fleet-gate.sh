#!/bin/bash
# PreToolUse:Bash hook — blocks raw multi-agent dispatch outside the registered orchestration wrappers.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/fleet-common.sh"

HOOK_INPUT=$(cat)
COMMAND=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

case "$COMMAND" in
  *"ensure-orchestrator.sh"*|*"open-dispatch-run.sh"*|*"launch-registered-worker.sh"*|*"send-registered-worker.sh"*|*"heartbeat-worker.sh"*|*"close-dispatch-run.sh"*)
    exit 0
    ;;
  *"fleet-cli launch"*|*"fleet-cli session send"*|*"fleet-cli try "*)
    ;;
  *)
    exit 0
    ;;
esac

echo "FLEET GATE: raw fleet-cli worker dispatch is blocked."
echo ""
echo "Use the registered orchestration wrappers instead:"
echo "  .claude/hooks/ensure-orchestrator.sh"
echo "  .claude/hooks/open-dispatch-run.sh"
echo "  .claude/hooks/launch-registered-worker.sh"
echo "  .claude/hooks/send-registered-worker.sh"
echo "  .claude/hooks/heartbeat-worker.sh"
echo "  .claude/hooks/close-dispatch-run.sh"
echo ""
echo "Rule: no orchestrator -> no dispatch run -> no registered worker -> no code changes."
exit 2
