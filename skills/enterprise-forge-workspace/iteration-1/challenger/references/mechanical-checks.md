# Mechanical Checks Reference

Seven binary checks that produce PASS or FAIL. No judgment calls — purely mechanical. Run these against the diff between your base branch and HEAD.

For an executable version, see `references/mechanical-checks.sh` in the enterprise skill root.

---

## M1: Import Resolution

Every `require()` and `import` in changed files must resolve to a real file.

```bash
FAIL=0
for f in $(git diff --name-only <base>...HEAD | grep -E '\.(js|jsx|ts|tsx)$' | grep -v node_modules); do
  [ -f "$f" ] || continue
  grep -n "require(" "$f" 2>/dev/null | grep -oP "require\(['\"](\./[^'\"]+)" | sed "s/require(['\"//" | while read -r mod; do
    dir=$(dirname "$f")
    resolved="$dir/$mod"
    if [ ! -f "$resolved" ] && [ ! -f "${resolved}.js" ] && [ ! -f "${resolved}.jsx" ] && [ ! -f "${resolved}/index.js" ]; then
      echo "M1 FAIL: $f imports '$mod' — file not found"
      FAIL=1
    fi
  done
done
echo "M1: $([ $FAIL -eq 0 ] && echo 'PASS' || echo 'FAIL')"
```

## M2: Uncommitted Files

No orphaned source files that should be tracked but aren't.

```bash
UNTRACKED=$(git ls-files --others --exclude-standard | grep -E '\.(js|jsx|ts|tsx|sql)$' | grep -v node_modules | grep -v dist | grep -v build)
[ -z "$UNTRACKED" ] && echo "M2: PASS" || echo "M2: FAIL — untracked: $UNTRACKED"
```

## M3: Dead Exports

Exports from changed files that nothing imports. Produces FLAGS (false positives possible with dynamic imports).

```bash
for f in $(git diff --name-only <base>...HEAD | grep -E '\.js$' | grep -v __tests__ | grep -v '\.test\.'); do
  [ -f "$f" ] || continue
  grep -oP '(module\.exports\s*=\s*\{[^}]+\}|exports\.\w+)' "$f" 2>/dev/null | grep -oP '\b\w+\b' | grep -v module | grep -v exports | while read -r name; do
    count=$(grep -rn "$name" apps/api/src/ --include="*.js" -l 2>/dev/null | grep -v "$f" | grep -v node_modules | wc -l)
    [ "$count" -eq 0 ] && echo "M3 FLAG: '$name' exported from $f — no importers found"
  done
done
```

## M4: Contract Crosscheck

Every postcondition in the contract has a passing test. For each PC-X: is there a test? Does it pass? Does it actually exercise the postcondition?

```bash
cd apps/api
npx jest --passWithNoTests 2>&1 | tail -30
grep -rn "PC-" src/__tests__/ --include="*.js" | head -20
```

## M5: Debug Artifacts

No debug code in production files (only checks ADDED lines, not existing code).

```bash
FAIL=0
for f in $(git diff --name-only <base>...HEAD | grep -E '\.js$' | grep -v __tests__ | grep -v '\.test\.'); do
  [ -f "$f" ] || continue
  HITS=$(git diff <base>...HEAD -- "$f" | grep "^+" | grep -v "^+++" | grep -cE "(console\.(log|debug)|debugger\b)")
  [ "$HITS" -gt 0 ] && echo "M5 FAIL: $f has $HITS debug artifacts" && FAIL=1
done
echo "M5: $([ $FAIL -eq 0 ] && echo 'PASS' || echo 'FAIL')"
```

## M6: Tenant Isolation

Every new query in changed files scopes to `tenant_id`.

```bash
FAIL=0
for f in $(git diff --name-only <base>...HEAD | grep -E '\.js$' | grep -v __tests__); do
  [ -f "$f" ] || continue
  git diff <base>...HEAD -- "$f" | grep "^+" | grep -v "^+++" | grep -iE "(SELECT .* FROM|INSERT INTO|UPDATE .* SET|DELETE FROM)" | while read -r line; do
    echo "$line" | grep -qi "tenant_id" || echo "M6 FLAG: $f — query may lack tenant_id: $line"
  done
done
```

## M7: Concurrency Check

No unguarded shared state mutations — module-level mutable state (let/var) is a flag.

```bash
for f in $(git diff --name-only <base>...HEAD | grep -E '\.js$' | grep -v __tests__); do
  [ -f "$f" ] || continue
  git diff <base>...HEAD -- "$f" | grep "^+" | grep -v "^+++" | grep -E "^.(let|var)\s+\w+\s*=" | while read -r line; do
    echo "M7 FLAG: $f — module-level mutable state: $line"
  done
done
```

---

## Verdict Rules

- **Any FAIL in M1, M2, M4, M5** = MECHANICAL FAIL. Stop and fix before proceeding.
- **M3, M6, M7** produce FLAGS that require judgment — review each flag individually.
