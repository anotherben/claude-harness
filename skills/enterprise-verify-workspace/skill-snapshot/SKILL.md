---
name: enterprise-verify
description: "Evidence-based verification before any completion claim. No 'should work' or 'probably fine' — paste fresh test output or don't claim done. 7-check verification sequence. Use before committing or claiming work is complete."
---

# Enterprise Verify — Evidence-Based Completion Verification

## The Iron Law

**No completion claims without fresh verification evidence.**

You have not verified anything until you have run commands and pasted output. Thinking about what should work is not verification. Reading code and believing it is correct is not verification. Only command output is evidence.

---

## Banned Language

The following phrases are BANNED before all 7 checks produce evidence. Using any of these before verification is a signal that you are about to claim completion without proof.

| Banned Phrase | What to Say Instead |
|---------------|-------------------|
| "should work" | "I need to run the tests to confirm" |
| "probably fine" | "I'll verify by running the suite" |
| "seems to" | "The test output shows [paste output]" |
| "looks good" | "All 7 checks passed — here is the evidence" |
| "I believe" | "The output confirms [specific result]" |
| "I'm confident" | "Tests: [N] passed, 0 failed — output below" |
| "I think it's ready" | "Verification sequence complete — report below" |
| "this fixes the issue" | "Test [name] now passes — output: [paste]" |
| "that should do it" | "Running verification now" |
| "looks correct" | "I'll run the checks to confirm" |

**If you catch yourself about to use banned language**: STOP. Run the verification sequence. Then report evidence.

---

## The 7-Check Verification Sequence

Every check produces a PASS or FAIL with evidence. No check is optional. Run them in order.

---

### Check 1: Full Test Suite

Run the complete test suite for the affected application.

```bash
cd apps/api && npx jest --no-coverage 2>&1 | tail -40
```

**Evidence required**: paste the summary output showing total tests, passed, failed.

```
CHECK 1 — TEST SUITE
═════════════════════
Command: cd apps/api && npx jest --no-coverage
Result:  [PASS / FAIL]
Output:
  Test Suites: [N] passed, [N] total
  Tests:       [N] passed, [N] total
  Time:        [N]s
```

**If ANY test fails**: STOP. Fix the failure before proceeding. Do not proceed with a failing test and note it for later — fix it NOW.

**If tests cannot run** (import error, syntax error): this counts as FAIL. Fix the error, re-run.

---

### Check 2: Postcondition Trace

For EVERY postcondition in the contract (or stated requirement), name the specific test that exercises it and confirm it passed.

```
CHECK 2 — POSTCONDITION TRACE
══════════════════════════════
Contract: [path to contract or "inline requirements"]

PC-1: [postcondition text]
  Test: [exact test description from test runner output]
  File: [test file path]
  Status: PASS

PC-2: [postcondition text]
  Test: [exact test description from test runner output]
  File: [test file path]
  Status: PASS

...

Result: [N]/[N] postconditions verified
```

**Rules**:
- Every postcondition MUST map to at least one test.
- Use the EXACT test description from the test runner output — do not paraphrase.
- If a postcondition has no test: FAIL. Write the test before proceeding.
- If a postcondition's test did not appear in the test output: FAIL. The test may not be running.

---

### Check 3: Regression Check

Confirm that no existing tests broke as a result of the changes.

```bash
# Compare current test count to baseline (if known)
cd apps/api && npx jest --no-coverage 2>&1 | grep -E "Tests:|Test Suites:"
```

```
CHECK 3 — REGRESSION CHECK
═══════════════════════════
New test failures: [NONE / list them]
Tests that were passing before and now fail:
  [NONE — or list each with the error]
Result: [PASS / FAIL]
```

**If regressions exist**: FAIL. Fix regressions before proceeding. Your change broke something — find out what and why.

**Common regression causes**:
- Changed a shared function's signature or return type
- Modified test fixtures/setup that other tests depend on
- Introduced a side effect that pollutes test state
- Changed database state that other tests assume

---

### Check 4: Build Verification

**Required when**: any frontend file (.jsx, .tsx, .css, React component, hook, or context) was changed.

**Skip when**: only backend files were changed AND no frontend files were modified.

```bash
cd apps/admin && npx vite build 2>&1 | tail -20
```

```
CHECK 4 — BUILD VERIFICATION
═════════════════════════════
Frontend files changed: [YES — list files / NO — skip this check]
Command: cd apps/admin && npx vite build
Result:  [PASS / FAIL / SKIPPED (no frontend changes)]
Output:
  [paste build output — especially any errors or warnings]
```

**If build fails**: FAIL. Common causes:
- Missing import — file referenced but not created/committed
- Missing export — component imported from wrong path
- Type error — wrong props or missing required props
- Missing dependency — package not installed

**A passing test suite does NOT guarantee a passing build.** Tests mock modules. The build resolves real imports. This check catches the gap.

---

### Check 5: Final Diff

Review the complete diff to confirm only expected files were changed.

```bash
git diff --stat
```

For uncommitted changes. If already committed:
```bash
git diff --stat HEAD~1
```

Or against the base branch:
```bash
git diff --stat main...HEAD
```

```
CHECK 5 — FINAL DIFF
═════════════════════
Command: git diff --stat [appropriate target]
Files changed:

  [paste git diff --stat output]

Expected files: [list of files you intended to change]
Unexpected files: [NONE / list any files you did NOT intend to change]

Classification:
  [file 1] — REQUIRED (in contract/plan)
  [file 2] — ENABLING (needed to support required change)
  [file 3] — DRIFT (not related to this task) ← REVERT THIS

Result: [PASS / FAIL (if drift detected)]
```

**If drift is detected**: revert the drifted files immediately.
```bash
git checkout -- path/to/drifted/file.js
```

**Scope creep signals**:
- "While I was in there, I also fixed..."
- Files in modules unrelated to the task
- Formatting-only changes in files you didn't functionally modify
- New features or enhancements not in the contract

---

### Check 6: Import Resolution

Every import in changed files must resolve to a real file.

```bash
# List changed files
git diff --name-only -- '*.js' '*.jsx' '*.ts' '*.tsx'

# For each changed file, verify imports resolve
```

Manual verification: for each changed file, read its imports and confirm the target file exists.

```
CHECK 6 — IMPORT RESOLUTION
════════════════════════════
Changed files with imports:

  [file 1]:
    import X from './path/to/module' → [EXISTS / MISSING]
    import Y from '../path/to/other' → [EXISTS / MISSING]

  [file 2]:
    import Z from './path/to/thing'  → [EXISTS / MISSING]
    const W = require('./path')      → [EXISTS / MISSING]

Result: [PASS / FAIL (if any MISSING)]
```

**If any import is MISSING**: FAIL. Either:
- The target file was not created
- The target file was not committed (check `git status` for untracked files)
- The import path is wrong

**This check catches**: the exact class of bug where tests pass (mocked imports) but production breaks (real imports).

---

### Check 7: Debug Artifact Check

No debug code ships to production.

```bash
# Check for debug artifacts in changed files
git diff -- '*.js' '*.jsx' '*.ts' '*.tsx' | grep '^+' | grep -v '^+++' | grep -iE 'console\.(log|debug|warn|info)|debugger|TODO|FIXME|HACK|XXX' | grep -v '\.test\.' | grep -v 'console\.error'
```

```
CHECK 7 — DEBUG ARTIFACT CHECK
═══════════════════════════════
Command: [grep command above]
Findings:

  [NONE — or list each finding with file and line]

Exceptions (allowed):
  - console.error in error handlers: ALLOWED
  - console.warn in deprecation notices: ALLOWED
  - TODO in test files: ALLOWED (tests are not production code)

Result: [PASS / FAIL (if non-excepted debug artifacts found)]
```

**If debug artifacts found**: remove them before committing.

---

## The Verification Report

After ALL 7 checks produce evidence, compile the final report:

```
═══════════════════════════════════════════════════════════
                 ENTERPRISE VERIFICATION REPORT
═══════════════════════════════════════════════════════════

## Summary
Task: [what was done]
Date: [YYYY-MM-DD]
Branch: [branch name]

## Verification Results

  Check 1 — Test Suite:         [PASS — N passed, 0 failed]
  Check 2 — Postcondition Trace: [PASS — N/N verified]
  Check 3 — Regression Check:   [PASS — no regressions]
  Check 4 — Build Verification: [PASS / SKIPPED (backend only)]
  Check 5 — Final Diff:         [PASS — N files, 0 drift]
  Check 6 — Import Resolution:  [PASS — all imports resolve]
  Check 7 — Debug Artifacts:    [PASS — none found]

  ────────────────────────────
  OVERALL: [PASS — all 7 checks green / FAIL — N checks failed]

## Evidence

### Test Output
[paste relevant test suite output]

### Postcondition Map
  PC-1: [text] → [test name] → PASS
  PC-2: [text] → [test name] → PASS
  ...

### Files Changed
[paste git diff --stat]

═══════════════════════════════════════════════════════════
```

---

## PERSIST VERIFICATION RESULTS (JSON)

After compiling the verification report, append results to the verification log JSON. This creates an audit trail — failed attempts remain visible to future sessions, preventing "verification amnesia."

```bash
node -e "
  const fs = require('fs');
  const f = '.claude/enterprise-state/<slug>-verification.json';
  let log = { verifications: [] };
  try { log = JSON.parse(fs.readFileSync(f)); } catch(e) {}
  log.verifications.push({
    type: 'verify',
    timestamp: new Date().toISOString(),
    checks: {
      test_suite:           { result: '<PASS/FAIL>', passed: <N>, failed: <N> },
      postcondition_trace:  { result: '<PASS/FAIL>', mapped: <N>, total: <N> },
      regression:           { result: '<PASS/FAIL>', new_failures: <N> },
      build:                { result: '<PASS/FAIL/SKIP>' },
      diff_classification:  { result: '<PASS/FAIL>', drift_files: [] },
      imports:              { result: '<PASS/FAIL>' },
      debug_artifacts:      { result: '<PASS/FAIL>' }
    },
    overall: '<PASS/FAIL>'
  });
  fs.writeFileSync(f, JSON.stringify(log, null, 2));
  console.log('Verification logged (' + log.verifications.length + ' total attempts)');
"
```

Also update the pipeline state:
```bash
node -e "
  const fs = require('fs');
  const f = '.claude/enterprise-state/<slug>.json';
  const s = JSON.parse(fs.readFileSync(f));
  s.stages.verify.status = '<PASS ? complete : failed>';
  s.stages.verify.completed_at = new Date().toISOString();
  fs.writeFileSync(f, JSON.stringify(s, null, 2));
"
```

**Rules:**
- Always append, never overwrite the verifications array
- Fill in actual values from the check results, not placeholders
- Previous failed attempts remain in the log — this is intentional

---

## When to Run This Skill

| Trigger | Action |
|---------|--------|
| About to say "it's done" | Run verification first |
| About to commit | Run verification first |
| About to create a PR | Run verification first |
| About to merge | Run verification first |
| Someone asks "is it working?" | Run verification, report evidence |
| Test suite just passed | Run checks 2-7 (check 1 already done) |
| "One more thing" was fixed | Re-run ALL 7 checks from scratch |

---

## Failure Recovery

When a check fails, follow this sequence:

1. **Fix the issue** — do not proceed with failures.
2. **Re-run the failed check** — confirm it now passes.
3. **Re-run check 1 (test suite)** — confirm the fix did not break anything else.
4. **Continue the sequence** from where you left off.
5. **If check 1 fails after a fix**: you introduced a regression. Revert and try again.

```
FAILURE RECOVERY LOG
════════════════════
Check [N] failed: [reason]
Fix applied: [what was done]
Check [N] re-run: [PASS / FAIL]
Check 1 re-run: [PASS — no regression]
Continuing from check [N+1]
```

---

## The Completion Gate

You may claim completion ONLY when:

1. All 7 checks show PASS (or SKIPPED with valid reason)
2. The verification report is printed with evidence
3. No banned language was used in the completion claim

**Valid completion claim**: "Verification complete. All 7 checks passed. Report above shows [N] tests passing, [N]/[N] postconditions verified, no regressions, no drift, all imports resolve, no debug artifacts."

**Invalid completion claim**: "I think this should work now. The code looks correct and I'm confident the tests will pass."

The difference: evidence vs. belief. Enterprise verification deals only in evidence.

---

## Edge Cases

### "The tests were already passing before my changes"

Still run them. Your changes may have broken them. Check 1 is not "were tests passing?" — it is "are tests passing NOW, after my changes?"

### "There is no contract / no formal postconditions"

Derive postconditions from the task description. If the task was "fix stock quantities on product detail page," then:
- PC-1: Stock quantities display correct values from database
- PC-2: No other fields on the page were broken by the fix
- PC-3: The fix works for products with zero stock, negative stock, and null stock

Every task has implicit postconditions. Make them explicit.

### "Only one file was changed — do I need all 7 checks?"

Yes. A one-line change can break the entire test suite (check 1), introduce a regression (check 3), or leave a debug artifact (check 7). The checks are fast. Run them all.

### "The test suite takes too long"

Run the targeted tests first for rapid feedback:
```bash
cd apps/api && npx jest --testPathPattern="<relevant_pattern>" --no-coverage
```

Then run the full suite for regression coverage:
```bash
cd apps/api && npx jest --no-coverage
```

Both must pass. The targeted run does not replace the full run.
