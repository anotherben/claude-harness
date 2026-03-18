#!/bin/bash
set -euo pipefail

# conductor/collect.sh — Aggregate results from a conductor dispatch wave
# Usage: bash ~/claude-harness/conductor/collect.sh --dispatch-dir /tmp/conductor-12345

# --- Defaults ---
DISPATCH_DIR=""
JSON_OUTPUT=false

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dispatch-dir) DISPATCH_DIR="$2"; shift 2 ;;
    --json)         JSON_OUTPUT=true; shift ;;
    -h|--help)
      cat <<'USAGE'
conductor/collect.sh — Aggregate results from a dispatch wave

FLAGS:
  --dispatch-dir <path>   Directory containing result JSON files (required)
  --json                  Output as JSON instead of human-readable summary
USAGE
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$DISPATCH_DIR" ]; then
  echo "Error: --dispatch-dir is required" >&2
  exit 1
fi

if [ ! -d "$DISPATCH_DIR" ]; then
  echo "Error: dispatch directory not found: $DISPATCH_DIR" >&2
  exit 1
fi

# --- Collect results ---
RESULT_FILES=()
while IFS= read -r -d '' f; do
  RESULT_FILES+=("$f")
done < <(find "$DISPATCH_DIR" -name "*-result.json" -print0 2>/dev/null | sort -z)

if [ ${#RESULT_FILES[@]} -eq 0 ]; then
  echo "No result files found in $DISPATCH_DIR" >&2
  exit 1
fi

# --- Parse each result ---
TOTAL=0
SUCCEEDED=0
FAILED=0
TOTAL_COST=0
MAX_DURATION=0
OK_WORKERS=()
FAIL_WORKERS=()

for result_file in "${RESULT_FILES[@]}"; do
  TOTAL=$((TOTAL + 1))

  # Parse fields
  NAME="$(python3 -c "import json; print(json.load(open('$result_file')).get('name', 'unknown'))" 2>/dev/null || echo "unknown")"
  SUCCESS="$(python3 -c "import json; print(json.load(open('$result_file')).get('success', False))" 2>/dev/null || echo "False")"
  COST="$(python3 -c "import json; print(json.load(open('$result_file')).get('cost_usd', 0))" 2>/dev/null || echo "0")"
  DURATION="$(python3 -c "import json; print(json.load(open('$result_file')).get('duration_ms', 0))" 2>/dev/null || echo "0")"
  MODEL="$(python3 -c "import json; print(json.load(open('$result_file')).get('model', '?'))" 2>/dev/null || echo "?")"
  BRANCH="$(python3 -c "import json; print(json.load(open('$result_file')).get('branch', ''))" 2>/dev/null || echo "")"
  STOP="$(python3 -c "import json; print(json.load(open('$result_file')).get('stop_reason', ''))" 2>/dev/null || echo "")"
  SESSION="$(python3 -c "import json; print(json.load(open('$result_file')).get('session_id', ''))" 2>/dev/null || echo "")"

  TOTAL_COST="$(python3 -c "print(round($TOTAL_COST + $COST, 2))")"
  if [ "$DURATION" -gt "$MAX_DURATION" ] 2>/dev/null; then
    MAX_DURATION="$DURATION"
  fi

  DURATION_STR="$(python3 -c "
d = int($DURATION) // 1000
if d >= 60:
    print(f'{d // 60}m {d % 60}s')
else:
    print(f'{d}s')
")"

  if [ "$SUCCESS" = "True" ]; then
    SUCCEEDED=$((SUCCEEDED + 1))
    OK_WORKERS+=("${NAME}|${MODEL}|${COST}|${DURATION_STR}|${BRANCH}")
  else
    FAILED=$((FAILED + 1))
    FAIL_WORKERS+=("${NAME}|${MODEL}|${COST}|${DURATION_STR}|${STOP}|${SESSION}")
  fi
done

# --- Format total duration ---
TOTAL_DURATION_STR="$(python3 -c "
d = int($MAX_DURATION) // 1000
if d >= 60:
    print(f'{d // 60}m {d % 60}s')
else:
    print(f'{d}s')
")"

# --- JSON output ---
if [ "$JSON_OUTPUT" = true ]; then
  python3 -c "
import json, glob

results = []
for f in sorted(glob.glob('$DISPATCH_DIR/*-result.json')):
    with open(f) as fh:
        results.append(json.load(fh))

summary = {
    'total_workers': $TOTAL,
    'succeeded': $SUCCEEDED,
    'failed': $FAILED,
    'total_cost_usd': $TOTAL_COST,
    'max_duration_ms': $MAX_DURATION,
    'workers': results,
    'ready_to_merge': [r['name'] for r in results if r.get('success')],
    'needs_attention': [r['name'] for r in results if not r.get('success')]
}
print(json.dumps(summary, indent=2))
"
  exit 0
fi

# --- Human-readable output ---
echo ""
echo -e "${BOLD}CONDUCTOR DISPATCH SUMMARY${NC}"
echo -e "  Workers: ${TOTAL} launched, ${GREEN}${SUCCEEDED} succeeded${NC}, ${RED}${FAILED} failed${NC}"
echo -e "  Total cost: ${BOLD}\$${TOTAL_COST}${NC}"
echo -e "  Wall-clock: ${TOTAL_DURATION_STR}"
echo ""

# Succeeded workers
for entry in "${OK_WORKERS[@]}"; do
  IFS='|' read -r w_name w_model w_cost w_dur w_branch <<< "$entry"
  printf "  ${GREEN}[OK]${NC}   %-20s %-8s \$%-8s %-8s branch: %s\n" \
    "$w_name" "$w_model" "$w_cost" "$w_dur" "$w_branch"
done

# Failed workers
for entry in "${FAIL_WORKERS[@]}"; do
  IFS='|' read -r w_name w_model w_cost w_dur w_stop w_session <<< "$entry"
  printf "  ${RED}[FAIL]${NC} %-20s %-8s \$%-8s %-8s %s\n" \
    "$w_name" "$w_model" "$w_cost" "$w_dur" "$w_stop"
done

echo ""

# Merge recommendations
if [ ${#OK_WORKERS[@]} -gt 0 ]; then
  echo -e "  ${GREEN}Ready to merge:${NC} $(printf '%s\n' "${OK_WORKERS[@]}" | cut -d'|' -f1 | tr '\n' ', ' | sed 's/,$//')"
fi
if [ ${#FAIL_WORKERS[@]} -gt 0 ]; then
  echo -e "  ${YELLOW}Needs attention:${NC} $(printf '%s\n' "${FAIL_WORKERS[@]}" | cut -d'|' -f1 | tr '\n' ', ' | sed 's/,$//')"
fi
echo ""
