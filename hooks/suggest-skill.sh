#!/bin/bash
# PreToolUse:Edit|Write hook — suggests domain skills when editing relevant files.
# Non-blocking (exit 0 always). Prints a suggestion line that Claude sees.
HOOK_INPUT=$(cat)
FILE_PATH=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)

PLATFORM_ROOT="${AGENT_PLATFORM_ROOT:-$HOME/.agent-platform}"
RULES_FILE="$PLATFORM_ROOT/compiled/skill-hints.json"

if [ -n "$FILE_PATH" ] && [ -f "$RULES_FILE" ]; then
  MATCHES=$(python3 - "$RULES_FILE" "$FILE_PATH" <<'PYEOF'
import json, sys

rules_path, file_path = sys.argv[1:3]
with open(rules_path, 'r', encoding='utf-8') as handle:
    rules = json.load(handle).get('rules', [])

needle = file_path.lower()
seen = set()
for rule in rules:
    skill = rule.get('skill')
    if not skill or skill in seen:
        continue
    match_paths = [str(item).lower() for item in rule.get('match_paths', [])]
    if any(path_fragment and path_fragment in needle for path_fragment in match_paths):
        seen.add(skill)
        message = rule.get('message', '').strip()
        if message:
            print(f"SKILL REMINDER: /{skill} — {message}")
        else:
            print(f"SKILL REMINDER: /{skill}")
PYEOF
  )

  if [ -n "$MATCHES" ]; then
    echo "$MATCHES"
    exit 0
  fi
fi

case "$FILE_PATH" in
  # REX SOAP / fulfillment / inventory planning
  *rexWebStore*|*rexSoap*|*rexFulfillment*|*rexInventoryPlanning*|*retailExpress*)
    echo "SKILL REMINDER: /rex-soap-protocol — protocol detection, envelope construction, error-as-success patterns" ;;

  # Queue / sync workers
  *SyncQueue*|*syncQueue*|*BackgroundSync*|*backgroundSync*|*syncCheckpoint*|*rexSync*|*worker*)
    echo "SKILL REMINDER: /sync-worker — atomic claims, backoff, checkpoint guards, echo detection" ;;

  # Shopify
  *shopify*|*Shopify*)
    echo "SKILL REMINDER: /shopify-integration — HMAC verification, pagination, transaction fetching" ;;

  # SQL / database / migrations
  *database/migrations*|*pool.query*|*.sql)
    echo "SKILL REMINDER: /sql-guard — tenant isolation, parameterized queries, type traps, Melbourne timezone" ;;

  # Handovers
  *docs/handovers/*)
    echo "SKILL REMINDER: /handover-writer — structured handover doc template" ;;
esac

exit 0
