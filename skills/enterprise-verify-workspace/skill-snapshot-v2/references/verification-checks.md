# The 7 Verification Checks

Every check produces PASS or FAIL with evidence. Run them in order. No check is optional.

---

## Check 1: Full Test Suite

Run the complete test suite for the affected application.

```bash
cd apps/api && npx jest --no-coverage 2>&1 | tail -40
```

**Evidence required**: paste the summary showing total tests, passed, failed.

```
CHECK 1 — TEST SUITE
=====================
Command: cd apps/api && npx jest --no-coverage
Result:  [PASS / FAIL]
Output:
  Test Suites: [N] passed, [N] total
  Tests:       [N] passed, [N] total
  Time:        [N]s
```

If ANY test fails: STOP and fix before proceeding. If tests can't run (import error, syntax error): this counts as FAIL.

---

## Check 2: Postcondition Trace

For every postcondition in the contract, name the specific test that exercises it and confirm it passed.

```
CHECK 2 — POSTCONDITION TRACE
==============================
Contract: [path]

PC-1: [postcondition text]
  Test: [exact test description from runner output]
  File: [test file path]
  Status: PASS

PC-2: ...

Result: [N]/[N] postconditions verified
```

Use the EXACT test description from the runner output — not a paraphrase. If a PC has no test, or the test didn't appear in runner output: FAIL.

If there's no formal contract, derive postconditions from the task description.

---

## Check 3: Regression Check

Confirm no existing tests broke as a result of the changes.

```bash
cd apps/api && npx jest --no-coverage 2>&1 | grep -E "Tests:|Test Suites:"
```

```
CHECK 3 — REGRESSION CHECK
===========================
New test failures: [NONE / list them]
Result: [PASS / FAIL]
```

Common regression causes: changed shared function signatures, modified test fixtures, introduced side effects, changed database state.

---

## Check 4: Build Verification

**Required when**: any frontend file (.jsx, .tsx, .css, React component, hook, or context) was changed.
**Skip when**: only backend files changed.

```bash
cd apps/admin && npx vite build 2>&1 | tail -20
```

A passing test suite does NOT guarantee a passing build — tests mock modules, the build resolves real imports.

---

## Check 5: Final Diff

Review the complete diff to confirm only expected files were changed.

```bash
git diff --stat
```

Classify each file:
- **REQUIRED**: in the contract/plan
- **ENABLING**: needed to support a required change
- **DRIFT**: not related to this task — revert immediately with `git checkout -- path/to/file`

Scope creep signals: "while I was in there I also fixed...", files in unrelated modules, formatting-only changes, features not in the contract.

---

## Check 6: Import Resolution

Every import in changed files must resolve to a real file.

```bash
git diff --name-only -- '*.js' '*.jsx' '*.ts' '*.tsx'
```

For each changed file, verify imports resolve. This catches the exact class of bug where tests pass (mocked imports) but production breaks (real imports).

---

## Check 7: Debug Artifact Check

No debug code ships to production.

```bash
git diff -- '*.js' '*.jsx' '*.ts' '*.tsx' | grep '^+' | grep -v '^+++' | grep -iE 'console\.(log|debug|warn|info)|debugger|TODO|FIXME|HACK|XXX' | grep -v '\.test\.' | grep -v 'console\.error'
```

Allowed exceptions:
- `console.error` in error handlers
- `console.warn` in deprecation notices
- TODO in test files (tests are not production code)

---

## Verification Report Template

```
===============================================
         ENTERPRISE VERIFICATION REPORT
===============================================

## Summary
Task: [what was done]
Date: [YYYY-MM-DD]
Branch: [branch name]

## Verification Results

  Check 1 — Test Suite:          [PASS — N passed, 0 failed]
  Check 2 — Postcondition Trace: [PASS — N/N verified]
  Check 3 — Regression Check:    [PASS — no regressions]
  Check 4 — Build Verification:  [PASS / SKIPPED (backend only)]
  Check 5 — Final Diff:          [PASS — N files, 0 drift]
  Check 6 — Import Resolution:   [PASS — all imports resolve]
  Check 7 — Debug Artifacts:     [PASS — none found]

  ────────────────────────────
  OVERALL: [PASS — all checks green / FAIL — N checks failed]

## Evidence
[paste test output, postcondition map, git diff --stat]
```
