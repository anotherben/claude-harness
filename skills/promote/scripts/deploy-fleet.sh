#!/usr/bin/env bash
# ==============================================================================
# deploy-fleet.sh — /promote step 6: pinned-deploy the 7 portal/API services to a
# target commit, then watch each to `live`. Timeout-safe (every curl has -m) so a
# slow Render call can't hang the caller. The primary API srv-d5bmjnmuk2gs73fcubeg
# (autoDeploy off) is NOT here — the promote script deploys it.
#
# Usage:  bash deploy-fleet.sh [<commit-sha>]
#   commit-sha defaults to origin/main's tip (run from a helpdesk checkout, or set
#   FLEET_TARGET_SHA). Render key read from keychain (never echoed).
#   Env: FLEET_POLL_MAX (default 40 rounds), FLEET_POLL_GAP (default 45s).
# Exit: 0 if all live; 1 if any build_failed/timeout (reports which).
# ==============================================================================
set -uo pipefail

TARGET="${1:-${FLEET_TARGET_SHA:-}}"
if [ -z "$TARGET" ]; then
  TARGET="$(git -C "${HELPDESK_DIR:-/Users/ben/helpdesk}" rev-parse origin/main 2>/dev/null)"
fi
[ -n "$TARGET" ] || { echo "ABORT: no target sha (arg, FLEET_TARGET_SHA, or origin/main)"; exit 2; }
RK="$(security find-generic-password -a ben -s htn-render-api -w 2>/dev/null)" || { echo "ABORT: no render key"; exit 2; }

# name:service-id
SVCS=(
  "admin-portal:srv-d5bmvvre5dus73fqn4t0"
  "supplier-portal:srv-d74r6f94tr6s73culpvg"
  "repairer-portal:srv-d5bn0c6r433s7392o7b0"
  "customer-portal:srv-d5bms6a4d50c73fbpqdg"
  "repairer-api:srv-d5bmnmchg0os73do2l6g"
  "admin-api:srv-d5bmmva4d50c73fbm8tg"
  "customer-api:srv-d5bmmai4d50c73fblsng"
)

echo "deploy-fleet -> ${TARGET:0:12}"
declare -a DEPS=()
for entry in "${SVCS[@]}"; do
  name="${entry%%:*}"; id="${entry##*:}"
  dep="$(curl -sS -m 25 --fail -X POST -H "Authorization: Bearer $RK" -H 'Content-Type: application/json' \
    -d "{\"commitId\":\"$TARGET\"}" "https://api.render.com/v1/services/$id/deploys" \
    | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.id||'')" 2>/dev/null)"
  if [ -n "$dep" ]; then DEPS+=("$name:$id:$dep"); echo "  triggered $name $dep"; else echo "  FAILED-POST $name"; fi
done
[ "${#DEPS[@]}" -eq "${#SVCS[@]}" ] || echo "  WARN: only ${#DEPS[@]}/${#SVCS[@]} triggered"

echo "--- watching to live ---"
POLL_MAX="${FLEET_POLL_MAX:-40}"; POLL_GAP="${FLEET_POLL_GAP:-45}"
for round in $(seq 1 "$POLL_MAX"); do
  sleep "$POLL_GAP"; alldone=1; failed=""; line=""
  for row in "${DEPS[@]}"; do
    name="${row%%:*}"; rest="${row#*:}"; id="${rest%%:*}"; dep="${rest##*:}"
    st="$(curl -sS -m 15 -H "Authorization: Bearer $RK" "https://api.render.com/v1/services/$id/deploys/$dep" \
      | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.status||'?')" 2>/dev/null)"
    line="$line ${name:0:4}=$st"
    case "$st" in
      live) ;;
      build_failed|update_failed|canceled|pre_deploy_failed) failed="$failed $name:$st"; ;;
      *) alldone=0 ;;
    esac
  done
  echo "$(date -u +%H:%M:%S)$line"
  if [ -n "$failed" ]; then echo "!!! FLEET DEPLOY FAILED:$failed — rollback that service to the previous sha"; exit 1; fi
  [ "$alldone" = "1" ] && { echo "FLEET ALL LIVE on ${TARGET:0:12}"; exit 0; }
done
echo "!!! FLEET WATCH TIMED OUT after $((POLL_MAX*POLL_GAP))s — check Render dashboard"
exit 1
