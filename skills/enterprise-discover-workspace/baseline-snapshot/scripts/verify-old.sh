#!/usr/bin/env bash
# verify.sh — Mechanical verification for enterprise pipeline
# Runs all 7 checks, produces structured JSON evidence.
# The agent reads the JSON instead of running commands itself.
#
# Usage:
#   bash verify.sh --base dev --contract docs/contracts/foo.md --output evidence.json
#   bash verify.sh --skip-build   # backend-only changes
#   bash verify.sh                # defaults: base=dev, auto-detect build need

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────
BASE_BRANCH="dev"
CONTRACT=""
SKIP_BUILD=false
OUTPUT=""
PROJECT_ROOT=""

# ── Parse args ────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)       BASE_BRANCH="$2"; shift 2 ;;
    --contract)   CONTRACT="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --output)     OUTPUT="$2"; shift 2 ;;
    --project)    PROJECT_ROOT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Find project root ──
# Walk up from CWD looking for apps/api (turbo monorepo marker)
if [[ -z "$PROJECT_ROOT" ]]; then
  _dir="$(pwd)"
  while [[ "$_dir" != "/" ]]; do
    if [[ -d "$_dir/apps/api" ]]; then
      PROJECT_ROOT="$_dir"
      break
    fi
    _dir="$(dirname "$_dir")"
  done
  # Fallback: try relative to script location
  if [[ -z "$PROJECT_ROOT" ]]; then
    PROJECT_ROOT="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel 2>/dev/null || echo "")"
  fi
fi

# Validate
if [[ ! -d "$PROJECT_ROOT/apps/api" ]]; then
  echo "ERROR: Cannot find apps/api at $PROJECT_ROOT" >&2
  exit 1
fi

# Default output path
if [[ -z "$OUTPUT" ]]; then
  SLUG="verification-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$PROJECT_ROOT/.claude/enterprise-state"
  OUTPUT="$PROJECT_ROOT/.claude/enterprise-state/${SLUG}.json"
fi

# Ensure output directory exists
mkdir -p "$(dirname "$OUTPUT")"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ── Helper: JSON-escape a string ──────────────────────────
json_escape() {
  python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$1"
}

# ── Temp files for collecting results ─────────────────────
RESULTS_DIR=$(mktemp -d)
trap "rm -rf $RESULTS_DIR" EXIT

# ══════════════════════════════════════════════════════════
# CHECK 1: Test Suite
# ══════════════════════════════════════════════════════════
echo "CHECK 1/7: Test Suite..."
TEST_OUTPUT=""
TEST_RESULT="FAIL"
TEST_PASSED=0
TEST_FAILED=0
TEST_TOTAL=0
TEST_SUITES_PASSED=0
TEST_SUITES_FAILED=0
TEST_SUITES_TOTAL=0

if TEST_OUTPUT=$(cd "$PROJECT_ROOT/apps/api" && npx jest --no-coverage --forceExit 2>&1); then
  TEST_RESULT="PASS"
fi

# Parse jest output for counts
TEST_PASSED=$(echo "$TEST_OUTPUT" | grep -oE 'Tests:.*([0-9]+) passed' | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo "0")
TEST_FAILED=$(echo "$TEST_OUTPUT" | grep -oE 'Tests:.*([0-9]+) failed' | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo "0")
TEST_TOTAL=$((TEST_PASSED + TEST_FAILED))
TEST_SUITES_PASSED=$(echo "$TEST_OUTPUT" | grep -oE 'Test Suites:.*([0-9]+) passed' | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo "0")
TEST_SUITES_FAILED=$(echo "$TEST_OUTPUT" | grep -oE 'Test Suites:.*([0-9]+) failed' | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo "0")
TEST_SUITES_TOTAL=$((TEST_SUITES_PASSED + TEST_SUITES_FAILED))

# Also extract all test names for postcondition trace
TEST_NAMES=$(echo "$TEST_OUTPUT" | grep -E '^\s*(✓|✕|✗|√|×|PASS|FAIL|○)\s' | sed 's/^[[:space:]]*//' || true)
# Fallback: grab lines that look like test descriptions
if [[ -z "$TEST_NAMES" ]]; then
  TEST_NAMES=$(echo "$TEST_OUTPUT" | grep -E '^\s+(✓|✕|✗|√|×|●)\s' || echo "$TEST_OUTPUT" | grep -E '^\s{4,}(✓|✕|✗|PASS|FAIL)' || true)
fi

# Save last 50 lines of test output as evidence
TEST_TAIL=$(echo "$TEST_OUTPUT" | tail -50)

echo "  → $TEST_RESULT (${TEST_PASSED} passed, ${TEST_FAILED} failed)"

# ══════════════════════════════════════════════════════════
# CHECK 2: Postcondition Trace (data collection)
# Agent maps PCs to tests — script provides the test list
# ══════════════════════════════════════════════════════════
echo "CHECK 2/7: Postcondition Trace (collecting test names)..."
PC_RESULT="MANUAL"
PC_CONTRACT_FOUND=false
PC_CONTRACT_CONTENT=""

if [[ -n "$CONTRACT" && -f "$CONTRACT" ]]; then
  PC_CONTRACT_FOUND=true
  # Extract postcondition lines from contract
  PC_CONTRACT_CONTENT=$(grep -iE '^\s*(PC-|postcondition|INV-)' "$CONTRACT" 2>/dev/null || echo "")
  PC_COUNT=$(echo "$PC_CONTRACT_CONTENT" | grep -c '.' || echo "0")
  echo "  → Found $PC_COUNT postconditions in contract. Agent must map to tests."
elif [[ -n "$CONTRACT" ]]; then
  echo "  → WARNING: Contract file not found: $CONTRACT"
else
  echo "  → No contract provided (--contract). Agent must derive postconditions from task."
fi

# ══════════════════════════════════════════════════════════
# CHECK 3: Regression Check
# ══════════════════════════════════════════════════════════
echo "CHECK 3/7: Regression Check..."
REGRESSION_RESULT="PASS"
REGRESSION_FAILURES=""

if [[ "$TEST_FAILED" -gt 0 ]]; then
  REGRESSION_RESULT="FAIL"
  REGRESSION_FAILURES=$(echo "$TEST_OUTPUT" | grep -A 3 'FAIL' | head -30 || true)
fi
echo "  → $REGRESSION_RESULT (${TEST_FAILED} failures)"

# ══════════════════════════════════════════════════════════
# CHECK 4: Build Verification
# ══════════════════════════════════════════════════════════
echo "CHECK 4/7: Build Verification..."
BUILD_RESULT="SKIP"
BUILD_OUTPUT=""

# Auto-detect if frontend files changed
FRONTEND_CHANGED=false
if git -C "$PROJECT_ROOT" diff --name-only "$BASE_BRANCH" -- 'apps/admin/' 2>/dev/null | grep -qE '\.(jsx?|tsx?|css|scss)$'; then
  FRONTEND_CHANGED=true
fi

if [[ "$SKIP_BUILD" == true ]]; then
  BUILD_RESULT="SKIP"
  BUILD_OUTPUT="Skipped via --skip-build flag"
  echo "  → SKIPPED (--skip-build)"
elif [[ "$FRONTEND_CHANGED" == false ]]; then
  BUILD_RESULT="SKIP"
  BUILD_OUTPUT="No frontend files changed"
  echo "  → SKIPPED (no frontend changes)"
else
  if BUILD_OUTPUT=$(cd "$PROJECT_ROOT/apps/admin" && npx vite build 2>&1 | tail -20); then
    BUILD_RESULT="PASS"
    echo "  → PASS"
  else
    BUILD_RESULT="FAIL"
    echo "  → FAIL"
  fi
fi

# ══════════════════════════════════════════════════════════
# CHECK 5: Final Diff
# ══════════════════════════════════════════════════════════
echo "CHECK 5/7: Final Diff..."
DIFF_STAT=$(cd "$PROJECT_ROOT" && git diff --stat "$BASE_BRANCH" 2>/dev/null || git diff --stat HEAD 2>/dev/null || echo "no diff available")
DIFF_FILES=$(cd "$PROJECT_ROOT" && git diff --name-only "$BASE_BRANCH" 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo "")
DIFF_FILE_COUNT=$(echo "$DIFF_FILES" | grep -c '.' 2>/dev/null || echo "0")

# Check for unstaged changes not in the diff
UNSTAGED=$(cd "$PROJECT_ROOT" && git diff --name-only 2>/dev/null || echo "")

echo "  → ${DIFF_FILE_COUNT} files changed"

# ══════════════════════════════════════════════════════════
# CHECK 6: Import Resolution
# ══════════════════════════════════════════════════════════
echo "CHECK 6/7: Import Resolution..."
IMPORT_RESULT="PASS"
UNRESOLVED_IMPORTS=""
CHANGED_SOURCE_FILES=$(cd "$PROJECT_ROOT" && git diff --name-only "$BASE_BRANCH" -- '*.js' '*.jsx' '*.ts' '*.tsx' 2>/dev/null || true)

unresolved_count=0
checked_count=0

for file in $CHANGED_SOURCE_FILES; do
  full_path="$PROJECT_ROOT/$file"
  [[ -f "$full_path" ]] || continue
  checked_count=$((checked_count + 1))

  # Extract require/import paths (skip node_modules packages)
  imports=$(grep -oE "(require\(['\"]\..*?['\"]|from ['\"]\..*?['\"])" "$full_path" 2>/dev/null | grep -oE "'[^']*'|\"[^\"]*\"" | tr -d "'\"" || true)

  for imp in $imports; do
    dir=$(dirname "$full_path")
    # Try exact path, then with extensions
    resolved=false
    for ext in "" ".js" ".jsx" ".ts" ".tsx" "/index.js" "/index.jsx" "/index.ts" "/index.tsx"; do
      if [[ -f "${dir}/${imp}${ext}" ]]; then
        resolved=true
        break
      fi
    done
    if [[ "$resolved" == false ]]; then
      UNRESOLVED_IMPORTS="${UNRESOLVED_IMPORTS}${file}: ${imp}\n"
      unresolved_count=$((unresolved_count + 1))
    fi
  done
done

if [[ $unresolved_count -gt 0 ]]; then
  IMPORT_RESULT="FAIL"
fi
echo "  → $IMPORT_RESULT ($checked_count files checked, $unresolved_count unresolved)"

# ══════════════════════════════════════════════════════════
# CHECK 7: Debug Artifacts
# ══════════════════════════════════════════════════════════
echo "CHECK 7/7: Debug Artifacts..."
DEBUG_RESULT="PASS"
DEBUG_FINDINGS=""

# Search diff for debug artifacts in non-test files
DEBUG_FINDINGS=$(cd "$PROJECT_ROOT" && git diff "$BASE_BRANCH" -- '*.js' '*.jsx' '*.ts' '*.tsx' 2>/dev/null \
  | grep '^+' \
  | grep -v '^+++' \
  | grep -v '\.test\.' \
  | grep -v '\.spec\.' \
  | grep -v '__tests__' \
  | grep -iE 'console\.(log|debug|info|warn)|debugger\b|TODO\b|FIXME\b|HACK\b|XXX\b' \
  | grep -v 'console\.error' \
  | head -20 \
  || true)

DEBUG_COUNT=0
if [[ -n "$DEBUG_FINDINGS" ]]; then
  DEBUG_COUNT=$(echo "$DEBUG_FINDINGS" | wc -l | tr -d ' ')
  DEBUG_RESULT="FAIL"
fi
echo "  → $DEBUG_RESULT ($DEBUG_COUNT artifacts found)"

# ══════════════════════════════════════════════════════════
# OVERALL VERDICT
# ══════════════════════════════════════════════════════════
OVERALL="PASS"
FAIL_COUNT=0

for check_result in "$TEST_RESULT" "$REGRESSION_RESULT" "$BUILD_RESULT" "$IMPORT_RESULT" "$DEBUG_RESULT"; do
  if [[ "$check_result" == "FAIL" ]]; then
    OVERALL="FAIL"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done
# PC trace is MANUAL — agent determines pass/fail
# Build SKIP doesn't count as failure

echo ""
echo "═══════════════════════════════════════"
echo "  OVERALL: $OVERALL ($FAIL_COUNT failures)"
echo "═══════════════════════════════════════"

# ══════════════════════════════════════════════════════════
# Write JSON evidence via temp files (avoids quoting issues)
# ══════════════════════════════════════════════════════════

# Write multiline data to temp files for Python to read safely
echo "$TEST_TAIL" > "$RESULTS_DIR/test_output.txt"
echo "$TEST_NAMES" > "$RESULTS_DIR/test_names.txt"
echo "$PC_CONTRACT_CONTENT" > "$RESULTS_DIR/postconditions.txt"
echo "$REGRESSION_FAILURES" > "$RESULTS_DIR/regression.txt"
echo "$BUILD_OUTPUT" > "$RESULTS_DIR/build_output.txt"
echo "$DIFF_FILES" > "$RESULTS_DIR/diff_files.txt"
echo "$DIFF_STAT" > "$RESULTS_DIR/diff_stat.txt"
echo "$UNRESOLVED_IMPORTS" > "$RESULTS_DIR/unresolved.txt"
echo "$DEBUG_FINDINGS" > "$RESULTS_DIR/debug_findings.txt"

python3 - "$RESULTS_DIR" "$OUTPUT" "$TIMESTAMP" "$BASE_BRANCH" "$CONTRACT" \
  "$TEST_RESULT" "$TEST_PASSED" "$TEST_FAILED" "$TEST_TOTAL" \
  "$TEST_SUITES_PASSED" "$TEST_SUITES_FAILED" "$TEST_SUITES_TOTAL" \
  "$PC_RESULT" "$PC_CONTRACT_FOUND" \
  "$REGRESSION_RESULT" \
  "$BUILD_RESULT" "$FRONTEND_CHANGED" \
  "$DIFF_FILE_COUNT" \
  "$IMPORT_RESULT" "$checked_count" "$unresolved_count" \
  "$DEBUG_RESULT" "$DEBUG_COUNT" \
  "$OVERALL" "$FAIL_COUNT" \
  <<'PYEOF'
import json, sys, os

def read_file(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return ""

def to_list(text):
    if not text:
        return []
    return [line for line in text.split("\n") if line.strip()]

args = sys.argv[1:]
results_dir = args[0]
output_path = args[1]

evidence = {
    "timestamp": args[2],
    "base_branch": args[3],
    "contract": args[4] or None,
    "checks": {
        "test_suite": {
            "result": args[5],
            "passed": int(args[6] or 0),
            "failed": int(args[7] or 0),
            "total": int(args[8] or 0),
            "suites_passed": int(args[9] or 0),
            "suites_failed": int(args[10] or 0),
            "suites_total": int(args[11] or 0),
            "output": read_file(os.path.join(results_dir, "test_output.txt"))
        },
        "postcondition_trace": {
            "result": args[12],
            "contract_found": args[13] == "true",
            "postconditions": read_file(os.path.join(results_dir, "postconditions.txt")),
            "test_names": read_file(os.path.join(results_dir, "test_names.txt")),
            "note": "Agent must map each postcondition to a specific test name from test_names"
        },
        "regression": {
            "result": args[14],
            "new_failures": int(args[7] or 0),
            "details": read_file(os.path.join(results_dir, "regression.txt"))
        },
        "build": {
            "result": args[15],
            "frontend_changed": args[16] == "true",
            "output": read_file(os.path.join(results_dir, "build_output.txt"))
        },
        "diff": {
            "result": "PASS",
            "file_count": int(args[17] or 0),
            "files": to_list(read_file(os.path.join(results_dir, "diff_files.txt"))),
            "stat": read_file(os.path.join(results_dir, "diff_stat.txt")),
            "note": "Agent must classify each file as REQUIRED, ENABLING, or DRIFT"
        },
        "imports": {
            "result": args[18],
            "files_checked": int(args[19] or 0),
            "unresolved_count": int(args[20] or 0),
            "unresolved": to_list(read_file(os.path.join(results_dir, "unresolved.txt")))
        },
        "debug_artifacts": {
            "result": args[21],
            "count": int(args[22] or 0),
            "findings": to_list(read_file(os.path.join(results_dir, "debug_findings.txt")))
        }
    },
    "overall": args[23],
    "fail_count": int(args[24] or 0)
}

os.makedirs(os.path.dirname(output_path), exist_ok=True)
with open(output_path, "w") as f:
    json.dump(evidence, f, indent=2)

print(f"\nEvidence written to: {output_path}")
PYEOF
