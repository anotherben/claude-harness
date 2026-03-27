#!/bin/bash
# Enterprise Mechanical Checks — Shared Verification Script
# Usage: bash mechanical-checks.sh --check <check_name> --base <base_branch> [--files "file1 file2"]
#
# Available checks:
#   imports      - Verify all require()/import resolve to real files
#   uncommitted  - Find untracked source files that should be committed
#   debug        - Scan for debug artifacts in production code
#   tenant       - Check SQL statements for tenant_id scoping
#   filesize     - Check file size limits (400 soft / 800 hard)
#   dead-exports - Find exports with no importers
#   all          - Run all checks
#
# Exit codes: 0 = PASS, 1 = FAIL, 2 = WARN (flags to review)

set -euo pipefail

CHECK=""
BASE="dev"
FILES=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --check) CHECK="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --files) FILES="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$CHECK" ]; then
  echo "Usage: bash mechanical-checks.sh --check <check_name> --base <base_branch>"
  echo "Checks: imports, uncommitted, debug, tenant, filesize, dead-exports, all"
  exit 1
fi

# Get changed files if not provided
if [ -z "$FILES" ]; then
  CHANGED_JS=$(git diff --name-only "$BASE"...HEAD 2>/dev/null | grep -E '\.(js|jsx)$' | grep -v node_modules || true)
  CHANGED_SRC=$(echo "$CHANGED_JS" | grep -vE '(__tests__|\.test\.|\.spec\.)' || true)
  CHANGED_TEST=$(echo "$CHANGED_JS" | grep -E '(__tests__|\.test\.|\.spec\.)' || true)
else
  CHANGED_JS="$FILES"
  CHANGED_SRC="$FILES"
  CHANGED_TEST=""
fi

check_imports() {
  echo "=== M1: Import Resolution ==="
  local FAIL=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ ! -f "$f" ] && continue
    local dir
    dir=$(dirname "$f")
    grep -oE "(require\(['\"]\.\.?/[^'\"]+['\"]|from ['\"]\.\.?/[^'\"]+['\"])" "$f" 2>/dev/null | grep -oE '\.\.?/[^"'"'"']+' | while read -r mod; do
      local resolved="$dir/$mod"
      if [ ! -f "$resolved" ] && [ ! -f "${resolved}.js" ] && [ ! -f "${resolved}.jsx" ] && [ ! -f "${resolved}/index.js" ] && [ ! -f "${resolved}/index.jsx" ]; then
        echo "  FAIL: $f imports '$mod' — file not found"
        FAIL=1
      fi
    done
  done <<< "$CHANGED_JS"
  if [ "$FAIL" -eq 0 ]; then echo "  PASS"; else return 1; fi
}

check_uncommitted() {
  echo "=== M2: Uncommitted Files ==="
  local UNTRACKED
  UNTRACKED=$(git ls-files --others --exclude-standard | grep -E '\.(js|jsx|ts|tsx|sql)$' | grep -v node_modules | grep -v dist | grep -v build || true)
  if [ -z "$UNTRACKED" ]; then
    echo "  PASS"
  else
    echo "  FAIL — untracked source files:"
    echo "$UNTRACKED" | sed 's/^/    /'
    return 1
  fi
}

check_debug() {
  echo "=== M5: Debug Artifacts ==="
  local FAIL=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ ! -f "$f" ] && continue
    local HITS
    HITS=$(git diff "$BASE"...HEAD -- "$f" 2>/dev/null | grep "^+" | grep -v "^+++" | grep -cE "(console\.(log|debug)|debugger\b)" || echo 0)
    if [ "$HITS" -gt 0 ]; then
      echo "  FAIL: $f has $HITS debug artifacts in new code"
      FAIL=1
    fi
  done <<< "$CHANGED_SRC"
  if [ "$FAIL" -eq 0 ]; then echo "  PASS"; else return 1; fi
}

check_tenant() {
  echo "=== M6: Tenant Isolation ==="
  local FLAGS=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ ! -f "$f" ] && continue
    git diff "$BASE"...HEAD -- "$f" 2>/dev/null | grep "^+" | grep -v "^+++" | grep -iE "(SELECT .* FROM|INSERT INTO|UPDATE .* SET|DELETE FROM)" | while read -r line; do
      if ! echo "$line" | grep -qi "tenant_id" && ! echo "$line" | grep -qi "customers"; then
        echo "  FLAG: $f — query may lack tenant_id:"
        echo "    $line"
        FLAGS=1
      fi
    done
  done <<< "$CHANGED_SRC"
  if [ "$FLAGS" -eq 0 ]; then echo "  PASS"; else echo "  Review flags above"; return 2; fi
}

check_filesize() {
  echo "=== M7: File Size Limits ==="
  local FAIL=0 WARN=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ ! -f "$f" ] && continue
    local LINES
    LINES=$(wc -l < "$f")
    if [ "$LINES" -gt 800 ]; then
      echo "  FAIL: $f ($LINES lines > 800 hard limit)"
      FAIL=1
    elif [ "$LINES" -gt 400 ]; then
      echo "  WARN: $f ($LINES lines > 400 soft limit)"
      WARN=1
    fi
  done <<< "$CHANGED_SRC"
  if [ "$FAIL" -gt 0 ]; then return 1; elif [ "$WARN" -gt 0 ]; then return 2; else echo "  PASS"; fi
}

check_dead_exports() {
  echo "=== M3: Dead Exports ==="
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ ! -f "$f" ] && continue
    grep -oP '(module\.exports\s*=\s*\{[^}]+\}|exports\.\w+|module\.exports\s*=\s*\w+)' "$f" 2>/dev/null | grep -oP '\b\w+\b' | grep -v module | grep -v exports | while read -r name; do
      local count
      count=$(grep -rn "$name" apps/api/src/ --include="*.js" -l 2>/dev/null | grep -v "$f" | grep -v node_modules | wc -l || echo 0)
      if [ "$count" -eq 0 ]; then
        echo "  FLAG: '$name' exported from $f — no importers found"
      fi
    done
  done <<< "$CHANGED_SRC"
  echo "  Review flags above (false positives possible for dynamic imports)"
}

# Run the requested check(s)
EXIT_CODE=0

run_check() {
  local check_fn="$1"
  $check_fn || { local rc=$?; if [ $rc -gt $EXIT_CODE ]; then EXIT_CODE=$rc; fi; }
}

case "$CHECK" in
  imports)      run_check check_imports ;;
  uncommitted)  run_check check_uncommitted ;;
  debug)        run_check check_debug ;;
  tenant)       run_check check_tenant ;;
  filesize)     run_check check_filesize ;;
  dead-exports) run_check check_dead_exports ;;
  all)
    run_check check_imports
    run_check check_uncommitted
    run_check check_debug
    run_check check_tenant
    run_check check_filesize
    run_check check_dead_exports
    ;;
  *) echo "Unknown check: $CHECK"; exit 1 ;;
esac

exit $EXIT_CODE
