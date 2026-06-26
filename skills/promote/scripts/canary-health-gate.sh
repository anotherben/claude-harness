#!/usr/bin/env bash
#
# BLK-5 baseline-relative canary health gate
# =========================================================================
# Operational watcher for the dev->main cutover (release-train #2290/#2291).
#
# WHY THIS EXISTS (the 503-on-449 trap):
#   The candidate /health (apps/api/src/services/healthService.js deriveStatus)
#   returns HTTP 503 / status:'unhealthy' whenever the sync-health monitor
#   reports monitorState=='unhealthy'. That monitor flips unhealthy when the
#   total sync backlog >= SYNC_HEALTH_TOTAL_ALERT_THRESHOLD (default 25).
#   Prod currently sits at ~449 standing backlog (mostly domain_outbox
#   publish_status='pending' over 180d + reconciliation backlogs). So absolute
#   /health is RED at T0 with ZERO regression. A naive "status must be healthy"
#   gate would block the cutover (or fire a false rollback) forever.
#
#   This gate is therefore BASELINE-RELATIVE: it captures prod's standing state
#   pre-cutover and only trips on a *delta* -- a sudden backlog JUMP, a NEW
#   failure class, DB disconnect, or 5xx -- not on the pre-existing 449.
#
# NO SECRETS IN THIS FILE. Auth + base URL come from environment variables.
#   - The canary staff session approach is defined in findings/sre-canary.json
#     (P3: POST /api/auth/login -> cookie). For the public /health probe used as
#     the primary gate signal, NO auth is required (P1: read-only unauthenticated).
#   - If you supply CANARY_AUTH_COOKIE / CANARY_AUTH_BEARER they are sent, but
#     they are read from the environment only -- never hardcoded, never logged.
#
# DEPENDENCIES: bash, curl, jq, date. No new project deps.
# =========================================================================

set -uo pipefail

# ----------------------------- Configuration -----------------------------
# All overridable via environment. Secrets MUST come from env, never literals.

API_BASE="${CANARY_API_BASE:-https://htn-helpdesk.onrender.com}"
HEALTH_PATH="${CANARY_HEALTH_PATH:-/health}"   # NOTE: /api/health 404s on prod (sre-canary P1 second_trap)
STATE_DIR="${CANARY_STATE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/state}"
BASELINE_FILE="${CANARY_BASELINE_FILE:-${STATE_DIR}/baseline.json}"
STATE_FILE="${CANARY_STATE_FILE:-${STATE_DIR}/canary-state.json}"
HEARTBEAT_FILE="${CANARY_HEARTBEAT_FILE:-${STATE_DIR}/heartbeat.json}"

# --- Gate thresholds (documented in BLK5-baseline-gate.md) ---
# total_backlog is allowed to rise to baseline * MULT + SLACK before it trips.
#   MULT 1.2  => a 20% rise over the standing backlog is tolerated as noise.
#   SLACK 25  => matches SYNC_HEALTH_TOTAL_ALERT_THRESHOLD; absorbs small
#                absolute churn when baseline is itself near zero.
BACKLOG_MULT="${CANARY_BACKLOG_MULT:-1.2}"
BACKLOG_SLACK="${CANARY_BACKLOG_SLACK:-25}"

# Cadence (seconds) — mirrors sre-canary.json cadence_and_duration.
#   Phase 1: every 5 min for the first hour (12 cycles).
CYCLE_INTERVAL="${CANARY_CYCLE_INTERVAL:-300}"
MAX_CYCLES="${CANARY_MAX_CYCLES:-12}"

CURL_TIMEOUT="${CANARY_CURL_TIMEOUT:-20}"

# --------------------------- Auth (env only) -----------------------------
# Optional. /health is public so these are not required for the primary gate.
CANARY_AUTH_COOKIE="${CANARY_AUTH_COOKIE:-}"
CANARY_AUTH_BEARER="${CANARY_AUTH_BEARER:-}"

mkdir -p "$STATE_DIR"

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

log() { printf '%s %s\n' "$(now_iso)" "$*" >&2; }

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    log "FATAL: jq is required but not found on PATH."
    exit 3
  fi
}

# Build curl auth args from env into the global CURL_AUTH_ARGS array without
# ever echoing the secret. Avoids `local -n` (nameref) so it runs on bash 3.2
# (the macOS system bash).
CURL_AUTH_ARGS=()
build_curl_auth_args() {
  CURL_AUTH_ARGS=()
  if [ -n "$CANARY_AUTH_COOKIE" ]; then
    CURL_AUTH_ARGS+=(-H "Cookie: ${CANARY_AUTH_COOKIE}")
  fi
  if [ -n "$CANARY_AUTH_BEARER" ]; then
    CURL_AUTH_ARGS+=(-H "Authorization: Bearer ${CANARY_AUTH_BEARER}")
  fi
}

# Fetch /health. Echoes "<body>\n<http_code>" to stdout.
fetch_health() {
  build_curl_auth_args
  # ${CURL_AUTH_ARGS[@]+"${CURL_AUTH_ARGS[@]}"} is the bash-3.2-safe way to
  # expand a possibly-empty array under `set -u`.
  curl -sS --max-time "$CURL_TIMEOUT" \
    -w $'\n%{http_code}' \
    ${CURL_AUTH_ARGS[@]+"${CURL_AUTH_ARGS[@]}"} \
    "${API_BASE}${HEALTH_PATH}" 2>/dev/null
}

# Extract total_backlog value from a /health body, or 0 if absent.
extract_total_backlog() {
  jq -r '
    (.checks.syncWorker.monitorIssues // [])
    | map(select(.code == "total_backlog") | .value)
    | (.[0] // 0)
  ' 2>/dev/null <<<"$1"
}

# Extract the set of monitorIssue codes (newline-separated, sorted unique).
extract_issue_codes() {
  jq -r '
    (.checks.syncWorker.monitorIssues // [])
    | map(.code) | unique | .[]
  ' 2>/dev/null <<<"$1"
}

write_heartbeat() {
  local cycle="$1"
  jq -n \
    --arg ts "$(now_iso)" \
    --argjson cycle "$cycle" \
    '{heartbeat_at: $ts, cycle: $cycle, pid: '"$$"'}' \
    > "$HEARTBEAT_FILE"
}

# ============================ BASELINE MODE ==============================
# PRE-CUTOVER: capture the standing prod /health snapshot as the reference.
cmd_baseline() {
  require_jq
  log "Capturing baseline from ${API_BASE}${HEALTH_PATH}"
  local resp http_code body
  resp="$(fetch_health)"
  http_code="$(tail -n1 <<<"$resp")"
  body="$(sed '$d' <<<"$resp")"

  if [ -z "$http_code" ]; then
    log "FATAL: no response from ${API_BASE}${HEALTH_PATH}"
    exit 2
  fi

  # 200 (current prod) or 503 (candidate code already deployed) are both
  # valid baseline states -- we record whatever standing state exists.
  if [ "$http_code" != "200" ] && [ "$http_code" != "503" ]; then
    log "FATAL: unexpected baseline HTTP ${http_code} (want 200 or 503). Refusing to baseline."
    exit 2
  fi

  local status database total_backlog codes_json
  status="$(jq -r '.status // "unknown"' <<<"$body")"
  database="$(jq -r '.checks.database // "unknown"' <<<"$body")"
  total_backlog="$(extract_total_backlog "$body")"
  codes_json="$(extract_issue_codes "$body" | jq -R . | jq -s 'sort')"

  if [ "$database" != "connected" ]; then
    log "WARN: baseline database != connected (${database}). Recording anyway, but verify before cutover."
  fi

  jq -n \
    --arg captured_at "$(now_iso)" \
    --arg api_base "$API_BASE" \
    --arg health_path "$HEALTH_PATH" \
    --argjson http_code "$http_code" \
    --arg status "$status" \
    --arg database "$database" \
    --argjson total_backlog "${total_backlog:-0}" \
    --argjson issue_codes "$codes_json" \
    --argjson backlog_mult "$BACKLOG_MULT" \
    --argjson backlog_slack "$BACKLOG_SLACK" \
    '{
      captured_at: $captured_at,
      api_base: $api_base,
      health_path: $health_path,
      http_code: $http_code,
      status: $status,
      database: $database,
      total_backlog: $total_backlog,
      issue_codes: $issue_codes,
      gate: { backlog_mult: $backlog_mult, backlog_slack: $backlog_slack }
    }' > "$BASELINE_FILE"

  log "Baseline written: ${BASELINE_FILE}"
  log "  status=${status} http=${http_code} database=${database} total_backlog=${total_backlog} issue_codes=$(tr '\n' ',' <<<"$(extract_issue_codes "$body")")"
}

# ============================== CHECK MODE ==============================
# Run a single canary cycle. Echoes verdict line and updates the state file.
# Returns 0 on PASS, 1 on FAIL.
run_cycle() {
  local cycle="$1"
  local resp http_code body
  resp="$(fetch_health)"
  http_code="$(tail -n1 <<<"$resp")"
  body="$(sed '$d' <<<"$resp")"

  local base_backlog base_codes
  base_backlog="$(jq -r '.total_backlog // 0' "$BASELINE_FILE")"
  base_codes="$(jq -r '.issue_codes[]? ' "$BASELINE_FILE" 2>/dev/null)"

  local status database total_backlog
  status="$(jq -r '.status // "unknown"' <<<"$body" 2>/dev/null)"
  database="$(jq -r '.checks.database // "unknown"' <<<"$body" 2>/dev/null)"
  total_backlog="$(extract_total_backlog "$body")"
  total_backlog="${total_backlog:-0}"

  # --- Gate components ---
  local fail_reasons=()
  local new_issues=()

  # (1) HTTP must not be 5xx. 503 is the documented /health "unhealthy" code and
  #     is NOT itself a failure -- we look past it at the structured payload.
  if [ -z "$http_code" ]; then
    fail_reasons+=("no_response")
  elif [ "$http_code" -ge 500 ] && [ "$http_code" != "503" ]; then
    fail_reasons+=("http_${http_code}")
  elif [ "$http_code" -ge 400 ] && [ "$http_code" -lt 500 ]; then
    fail_reasons+=("http_${http_code}")
  fi

  # (2) Database must be connected.
  if [ "$database" != "connected" ]; then
    fail_reasons+=("db_${database}")
  fi

  # (3) Backlog must stay within baseline * MULT + SLACK.
  local threshold
  threshold="$(jq -n --argjson b "$base_backlog" --argjson m "$BACKLOG_MULT" --argjson s "$BACKLOG_SLACK" '($b * $m) + $s | floor')"
  local backlog_ok=1
  if [ "$total_backlog" -gt "$threshold" ]; then
    backlog_ok=0
    fail_reasons+=("backlog_jump_${total_backlog}_gt_${threshold}")
  fi

  # delta_pct vs baseline (guard divide-by-zero).
  local delta_pct
  delta_pct="$(jq -n --argjson cur "$total_backlog" --argjson base "$base_backlog" '
    if $base == 0 then (if $cur == 0 then 0 else 100 end)
    else (($cur - $base) / $base * 100) end | (. * 10 | round / 10)
  ')"

  # (4) No NEW monitorIssue code that was not present in baseline.
  local cur_codes
  cur_codes="$(extract_issue_codes "$body")"
  while IFS= read -r code; do
    [ -z "$code" ] && continue
    if ! grep -qxF "$code" <<<"$base_codes"; then
      new_issues+=("$code")
      fail_reasons+=("new_issue_${code}")
    fi
  done <<<"$cur_codes"

  local verdict="PASS"
  if [ "${#fail_reasons[@]}" -gt 0 ]; then
    verdict="FAIL"
  fi

  # --- Emit machine-readable state file ---
  local new_issues_json fail_json
  new_issues_json="$(printf '%s\n' "${new_issues[@]:-}" | jq -R 'select(length>0)' | jq -s 'unique')"
  fail_json="$(printf '%s\n' "${fail_reasons[@]:-}" | jq -R 'select(length>0)' | jq -s '.')"

  jq -n \
    --arg checked_at "$(now_iso)" \
    --argjson cycle "$cycle" \
    --argjson http_code "${http_code:-0}" \
    --arg status "$status" \
    --arg database "$database" \
    --argjson total_backlog "$total_backlog" \
    --argjson baseline "$base_backlog" \
    --argjson threshold "$threshold" \
    --argjson delta_pct "$delta_pct" \
    --argjson backlog_ok "$backlog_ok" \
    --argjson new_issues "$new_issues_json" \
    --argjson fail_reasons "$fail_json" \
    --arg verdict "$verdict" \
    '{
      checked_at: $checked_at,
      cycle: $cycle,
      http_code: $http_code,
      status: $status,
      database: $database,
      total_backlog: $total_backlog,
      baseline: $baseline,
      threshold: $threshold,
      delta_pct: $delta_pct,
      backlog_ok: ($backlog_ok == 1),
      new_issues: $new_issues,
      fail_reasons: $fail_reasons,
      verdict: $verdict
    }' > "$STATE_FILE"

  write_heartbeat "$cycle"

  printf '%s cycle=%s %s http=%s db=%s backlog=%s (baseline=%s threshold=%s delta=%s%%) new_issues=[%s]%s\n' \
    "$(now_iso)" "$cycle" "$verdict" "${http_code:-NONE}" "$database" \
    "$total_backlog" "$base_backlog" "$threshold" "$delta_pct" \
    "$(printf '%s' "${new_issues[*]:-}")" \
    "$([ "$verdict" = FAIL ] && printf ' reasons=[%s]' "${fail_reasons[*]}" || true)"

  [ "$verdict" = "PASS" ]
}

cmd_check() {
  require_jq
  if [ ! -f "$BASELINE_FILE" ]; then
    log "FATAL: baseline not found (${BASELINE_FILE}). Run '$0 baseline' pre-cutover first."
    exit 2
  fi
  run_cycle "${1:-1}"
}

# ============================== WATCH MODE ==============================
# POST-DEPLOY loop: run cycles on cadence until MAX_CYCLES or a FAIL.
cmd_watch() {
  require_jq
  if [ ! -f "$BASELINE_FILE" ]; then
    log "FATAL: baseline not found (${BASELINE_FILE}). Run '$0 baseline' pre-cutover first."
    exit 2
  fi
  log "Starting canary watch: ${MAX_CYCLES} cycles @ ${CYCLE_INTERVAL}s, base=${API_BASE}"
  local cycle=1 fails=0
  while [ "$cycle" -le "$MAX_CYCLES" ]; do
    if ! run_cycle "$cycle"; then
      fails=$((fails + 1))
      log "Cycle ${cycle} FAILED (cumulative fails=${fails}). State: ${STATE_FILE}"
      # A FAIL is a candidate rollback trigger (sre-canary T1-T7). The watcher
      # NEVER self-executes rollback; it surfaces the verdict and stops the loop
      # so an operator/agent can map it to the §7 runbook.
      log "Halting watch on FAIL for operator review (no auto-rollback per §8.0 NO-SILENT-FIX)."
      printf 'FINAL VERDICT: FAIL at cycle %s — see %s\n' "$cycle" "$STATE_FILE"
      exit 1
    fi
    if [ "$cycle" -lt "$MAX_CYCLES" ]; then
      sleep "$CYCLE_INTERVAL"
    fi
    cycle=$((cycle + 1))
  done
  log "All ${MAX_CYCLES} cycles PASSED."
  printf 'FINAL VERDICT: PASS — %s consecutive clean cycles\n' "$MAX_CYCLES"
}

# ========================= DEAD-MAN'S-SWITCH ===========================
# Liveness check: a separate process (or the operator) reads the heartbeat and
# alarms if the watcher has gone silent. Round-2 attack flagged the watcher had
# no liveness check -- this closes that gap. Default staleness = 2x cadence.
cmd_liveness() {
  require_jq
  local max_age="${1:-$((CYCLE_INTERVAL * 2))}"
  if [ ! -f "$HEARTBEAT_FILE" ]; then
    printf 'DEAD: no heartbeat file at %s\n' "$HEARTBEAT_FILE"
    exit 1
  fi
  local hb_epoch now_epoch age
  hb_epoch="$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$(jq -r '.heartbeat_at' "$HEARTBEAT_FILE")" +%s 2>/dev/null \
            || date -u -d "$(jq -r '.heartbeat_at' "$HEARTBEAT_FILE")" +%s 2>/dev/null)"
  now_epoch="$(date -u +%s)"
  age=$((now_epoch - hb_epoch))
  if [ "$age" -gt "$max_age" ]; then
    printf 'DEAD: watcher heartbeat is %ss old (> %ss). Watcher likely died — investigate.\n' "$age" "$max_age"
    exit 1
  fi
  printf 'ALIVE: heartbeat %ss old (<= %ss)\n' "$age" "$max_age"
}

usage() {
  cat <<'EOF'
BLK-5 baseline-relative canary health gate

USAGE:
  canary-health-gate.sh baseline            Capture pre-cutover prod /health snapshot
  canary-health-gate.sh check [CYCLE_N]     Run one canary cycle (PASS/FAIL)
  canary-health-gate.sh watch               Post-deploy loop (MAX_CYCLES @ CYCLE_INTERVAL)
  canary-health-gate.sh liveness [MAX_AGE]  Dead-man's-switch: alarm if watcher heartbeat stale

ENVIRONMENT (all optional; secrets via env ONLY, never hardcoded):
  CANARY_API_BASE        default https://htn-helpdesk.onrender.com
  CANARY_HEALTH_PATH     default /health  (NOT /api/health — 404s on prod)
  CANARY_STATE_DIR       default ./state next to this script
  CANARY_BACKLOG_MULT    default 1.2
  CANARY_BACKLOG_SLACK   default 25
  CANARY_CYCLE_INTERVAL  default 300 (5 min)
  CANARY_MAX_CYCLES      default 12 (first hour)
  CANARY_AUTH_COOKIE     optional staff session cookie (e.g. "connect.sid=...")
  CANARY_AUTH_BEARER     optional bearer token
  CANARY_CURL_TIMEOUT    default 20

GATE FORMULA (per cycle):
  HEALTHY = (http not 5xx other than the documented 503)
        AND (checks.database == "connected")
        AND (total_backlog <= baseline.total_backlog * 1.2 + 25)
        AND (no monitorIssue code absent from the baseline set)
EOF
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    baseline) cmd_baseline "$@" ;;
    check)    cmd_check "$@" ;;
    watch)    cmd_watch "$@" ;;
    liveness) cmd_liveness "$@" ;;
    -h|--help|help|"") usage ;;
    *) log "Unknown command: ${cmd}"; usage; exit 64 ;;
  esac
}

main "$@"
